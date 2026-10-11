import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import { authorize, authzInput, type AuthorizationPort } from '../authz.js';
import {
  isStale,
  normalizeSample,
  OPS_RESOURCE_TYPE,
  REFRESH_ACTION,
  SampleRejected,
  VIEW_CODES,
  VIEW_DEFINITIONS,
  viewResourceId,
  worstStatus,
  type PortSample,
  type RefreshOutcome,
  type ViewCode,
  type ViewStatus,
} from '../domain/model.js';
import { Cmp046Error, detail } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN } from '../outbox.js';
import type { SummaryPorts } from '../ports/summary-port.js';
import type { OpsRepository, OpsTx, SnapshotRow } from '../repo/types.js';
import type { TenantContext } from '../types.js';

export interface OpsServiceDeps {
  repo: OpsRepository;
  authorizer: AuthorizationPort;
  ports: SummaryPorts;
  clock: () => Date;
  portTimeoutMs?: number;
}

export interface Idempotency {
  key: string;
  fingerprint: string;
  endpoint: string;
}

export interface CommandResult {
  status: number;
  body: unknown;
}

interface Committed {
  status: number;
  body: unknown;
}

const DEFAULT_PORT_TIMEOUT_MS = 5_000;
/** Dashboards are staff surfaces; citizens never reach them, whatever the policy data says. */
const STAFF_ACTOR_TYPES: readonly TenantContext['actor']['type'][] = [
  'OFFICER',
  'PRIVILEGED_ADMIN',
  'SYSTEM',
];

export function snapshotView(row: SnapshotRow, now: Date): Record<string, unknown> {
  const def = VIEW_DEFINITIONS[row.view_code];
  return {
    view_code: row.view_code,
    source_component: row.source_component,
    status: row.status,
    stale: isStale(row.as_of, now, def.maxAgeSeconds),
    max_age_seconds: def.maxAgeSeconds,
    as_of: row.as_of,
    source_observed_at: row.source_observed_at,
    last_attempt_at: row.last_attempt_at,
    last_error_code: row.last_error_code,
    snapshot_version: row.snapshot_version,
    metrics: row.metrics,
    non_authoritative: true,
  };
}

function errorCodeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return code;
  return 'SOURCE_PORT_FAILED';
}

export class OperationalDashboardService {
  constructor(private readonly deps: OpsServiceDeps) {}

  private assertNotInTx(): void {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp046Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
  }

  private assertStaff(ctx: TenantContext): void {
    if (!STAFF_ACTOR_TYPES.includes(ctx.actor.type)) {
      throw new Cmp046Error('SF-AUTH-002', detail('ACTOR_NOT_PERMITTED'));
    }
  }

  /** Records a DENIED audit event for a policy refusal; other failures are not audited here. */
  private async guard(ctx: TenantContext, action: string, viewCode: ViewCode): Promise<void> {
    this.assertNotInTx();
    this.assertStaff(ctx);
    try {
      await authorize(this.deps.authorizer, authzInput(ctx, action));
    } catch (err) {
      if (err instanceof Cmp046Error && err.code === 'SF-AUTH-002') {
        await this.auditDenied(ctx, action, viewCode);
      }
      throw err;
    }
  }

  private async auditDenied(ctx: TenantContext, action: string, viewCode: ViewCode): Promise<void> {
    const now = this.deps.clock();
    await this.deps.repo.withTx(ctx, (tx) =>
      appendAudit(tx, ctx, {
        action,
        actionClass: action === REFRESH_ACTION ? 'WRITE' : 'READ',
        resourceType: OPS_RESOURCE_TYPE,
        resourceId: viewResourceId(ctx.tenant_id, viewCode),
        result: 'DENIED',
        now,
      }),
    );
  }

  async getView(ctx: TenantContext, viewCode: ViewCode): Promise<CommandResult> {
    const def = VIEW_DEFINITIONS[viewCode];
    await this.guard(ctx, def.readAction, viewCode);
    const now = this.deps.clock();
    const row = await this.deps.repo.withTx(ctx, async (tx) => {
      const snapshot = await tx.getSnapshot(viewCode);
      await appendAudit(tx, ctx, {
        action: def.readAction,
        actionClass: 'READ',
        resourceType: OPS_RESOURCE_TYPE,
        resourceId: viewResourceId(ctx.tenant_id, viewCode),
        result: 'SUCCESS',
        now,
      });
      return snapshot;
    });
    if (!row) throw new Cmp046Error('SF-SYS-002', detail('VIEW_NOT_REFRESHED'));
    return { status: 200, body: snapshotView(row, now) };
  }

  /** Lists only the views the PDP allows. A PDP outage fails the whole call closed (503). */
  async listViews(ctx: TenantContext): Promise<CommandResult> {
    this.assertNotInTx();
    this.assertStaff(ctx);
    const allowed: ViewCode[] = [];
    for (const code of VIEW_CODES) {
      try {
        await authorize(this.deps.authorizer, authzInput(ctx, VIEW_DEFINITIONS[code].readAction));
        allowed.push(code);
      } catch (err) {
        if (!(err instanceof Cmp046Error && err.code === 'SF-AUTH-002')) throw err;
      }
    }
    if (allowed.length === 0) {
      await this.auditDenied(ctx, 'OPS_VIEW_LIST', 'SLA_SUMMARY');
      throw new Cmp046Error('SF-AUTH-002');
    }
    const now = this.deps.clock();
    const rows = await this.deps.repo.withTx(ctx, async (tx) => {
      const all = await tx.listSnapshots();
      await appendAudit(tx, ctx, {
        action: 'OPS_VIEW_LIST',
        actionClass: 'READ',
        resourceType: OPS_RESOURCE_TYPE,
        resourceId: viewResourceId(ctx.tenant_id, 'LIST'),
        result: 'SUCCESS',
        now,
      });
      return all;
    });
    const byCode = new Map(rows.map((r) => [r.view_code, r]));
    const views = allowed.map((code) => {
      const row = byCode.get(code);
      if (row) return snapshotView(row, now);
      return {
        view_code: code,
        source_component: VIEW_DEFINITIONS[code].sourceComponent,
        status: 'UNAVAILABLE' as ViewStatus,
        stale: true,
        max_age_seconds: VIEW_DEFINITIONS[code].maxAgeSeconds,
        as_of: null,
        last_error_code: 'NEVER_REFRESHED',
        metrics: [],
        non_authoritative: true,
      };
    });
    const overall = worstStatus(views.map((v) => v['status'] as ViewStatus));
    return { status: 200, body: { overall_status: overall, views } };
  }

  /**
   * Re-reads one owner port and replaces this tenant's derived snapshot. Ports are read-only
   * and run before the short authoritative transaction; the transaction holds no network call.
   */
  async refreshView(
    ctx: TenantContext,
    viewCode: ViewCode,
    idem: Idempotency,
  ): Promise<CommandResult> {
    await this.guard(ctx, REFRESH_ACTION, viewCode);
    const { sample, outcome, errorCode } = await this.readSource(ctx, viewCode);
    const now = this.deps.clock();
    const committed = await this.deps.repo.withTx(ctx, async (tx): Promise<Committed> => {
      const claim = await tx.claimIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        fingerprint: idem.fingerprint,
        now,
      });
      if (claim !== 'claimed') return claim;
      const result = await this.applyRefresh(tx, ctx, viewCode, sample, outcome, errorCode, now);
      await tx.completeIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        status: result.status,
        body: result.body,
      });
      return result;
    });
    return committed;
  }

  private async readSource(
    ctx: TenantContext,
    viewCode: ViewCode,
  ): Promise<{ sample: PortSample | null; outcome: RefreshOutcome; errorCode: string | null }> {
    this.assertNotInTx();
    const port = this.deps.ports[viewCode];
    const timeoutMs = this.deps.portTimeoutMs ?? DEFAULT_PORT_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    try {
      const raw = await Promise.race([
        port.fetchSummary(ctx),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Object.assign(new Error('source timeout'), { code: 'SOURCE_TIMEOUT' })),
            timeoutMs,
          );
        }),
      ]);
      return { sample: normalizeSample(raw), outcome: 'SUCCESS', errorCode: null };
    } catch (err) {
      if (err instanceof SampleRejected) {
        return { sample: null, outcome: 'PAYLOAD_INVALID', errorCode: 'PORT_PAYLOAD_INVALID' };
      }
      return { sample: null, outcome: 'SOURCE_FAILED', errorCode: errorCodeOf(err) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async applyRefresh(
    tx: OpsTx,
    ctx: TenantContext,
    viewCode: ViewCode,
    sample: PortSample | null,
    outcome: RefreshOutcome,
    errorCode: string | null,
    now: Date,
  ): Promise<Committed> {
    const def = VIEW_DEFINITIONS[viewCode];
    const nowIso = now.toISOString();
    const existing = await tx.getSnapshotForUpdate(viewCode);
    const base: SnapshotRow = existing ?? {
      tenant_id: ctx.tenant_id,
      snapshot_id: randomUUID(),
      view_code: viewCode,
      source_component: def.sourceComponent,
      status: 'UNAVAILABLE',
      metrics: [],
      source_observed_at: null,
      as_of: null,
      last_attempt_at: nowIso,
      last_error_code: null,
      snapshot_version: 0,
      created_at: nowIso,
      updated_at: nowIso,
    };
    const next: SnapshotRow =
      sample === null
        ? {
            ...base,
            status: 'UNAVAILABLE',
            last_attempt_at: nowIso,
            last_error_code: errorCode,
            snapshot_version: base.snapshot_version + 1,
            updated_at: nowIso,
          }
        : {
            ...base,
            status: sample.status,
            metrics: sample.metrics,
            source_observed_at: sample.source_observed_at ?? null,
            as_of: nowIso,
            last_attempt_at: nowIso,
            last_error_code: null,
            snapshot_version: base.snapshot_version + 1,
            updated_at: nowIso,
          };
    if (existing) await tx.updateSnapshot(next);
    else await tx.insertSnapshot(next);
    await tx.insertRefreshLog({
      tenant_id: ctx.tenant_id,
      refresh_id: randomUUID(),
      view_code: viewCode,
      outcome,
      error_code: errorCode,
      resulting_status: next.status,
      attempted_at: nowIso,
      actor_id: ctx.actor.id,
      correlation_id: ctx.correlation_id,
    });
    await tx.insertOutbox(
      envelopeOf({
        eventType: 'OpsViewRefreshed',
        tenantId: ctx.tenant_id,
        cellId: ctx.cell_id,
        aggregateType: 'OpsViewSnapshot',
        aggregateId: next.snapshot_id,
        aggregateVersion: next.snapshot_version,
        occurredAt: nowIso,
        correlationId: ctx.correlation_id,
        actor: ctx.actor,
        data: {
          view_code: viewCode,
          source_component: def.sourceComponent,
          status: next.status,
          refresh_outcome: outcome,
          metric_count: next.metrics.length,
          snapshot_version: next.snapshot_version,
          non_authoritative: true,
        },
      }),
      TOPIC_DOMAIN,
    );
    await appendAudit(tx, ctx, {
      action: REFRESH_ACTION,
      actionClass: 'WRITE',
      resourceType: OPS_RESOURCE_TYPE,
      resourceId: viewResourceId(ctx.tenant_id, viewCode),
      result: outcome === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      ...(errorCode === null ? {} : { reason: errorCode }),
      now,
    });
    return {
      status: 200,
      body: { refresh_outcome: outcome, view: snapshotView(next, now) },
    };
  }
}
