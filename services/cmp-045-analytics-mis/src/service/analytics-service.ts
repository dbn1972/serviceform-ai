import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import {
  ANALYTICS_ACTIONS,
  authorize,
  authzInput,
  type AnalyticsAction,
  type AuthorizationPort,
} from '../authz.js';
import { parseEnvelope } from '../domain/envelope.js';
import {
  contributionOf,
  matchesDefinition,
  ProjectionError,
  type ProjectionSpec,
} from '../domain/projection.js';
import { metricPointId } from '../domain/uuid.js';
import { Cmp045Error, detail } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN, type DomainEventType } from '../outbox.js';
import type { EventReplayPort } from '../ports/replay-port.js';
import type {
  AnalyticsRepository,
  AnalyticsTx,
  DefinitionRow,
  MetricPointRow,
} from '../repo/types.js';
import type { EventEnvelope, TenantContext } from '../types.js';
import type { DefinitionInput, ParsedMetricQuery } from './input.js';

export const INGEST_CONSUMER_GROUP = 'cmp-045.projection';
export const DEFAULT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const DEFAULT_REBUILD_BATCH_SIZE = 500;
export const DEFAULT_MAX_REBUILD_BATCHES = 2000;
export const DEFAULT_REBUILD_LEASE_MS = 15 * 60 * 1000;

export interface AnalyticsServiceDeps {
  repo: AnalyticsRepository;
  authorizer: AuthorizationPort;
  replay: EventReplayPort;
  /** Server-authoritative time source. The only clock the service ever consults. */
  clock: () => Date;
  /** Workload identity of the event consumer (CMP-038 subscription); supplied by the host. */
  consumerActorId: string;
  maxFutureSkewMs?: number;
  rebuildBatchSize?: number;
  maxRebuildBatches?: number;
  rebuildLeaseMs?: number;
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

export interface IngestResult {
  event_id: string;
  duplicate_delivery: boolean;
  matched_definitions: number;
  contributions_applied: number;
  contributions_duplicate: number;
  unclassified_dimensions: number;
}

export function specOf(row: DefinitionRow): ProjectionSpec {
  return {
    source_event_type: row.source_event_type,
    source_aggregate_type: row.source_aggregate_type,
    source_schema_version: row.source_schema_version,
    aggregation: row.aggregation,
    value_field: row.value_field,
    period_granularity: row.period_granularity,
    dimensions: row.dimensions,
  };
}

export function definitionView(row: DefinitionRow): Record<string, unknown> {
  return {
    definition_id: row.definition_id,
    metric_code: row.metric_code,
    version_no: row.version_no,
    status: row.status,
    publication_ref: row.publication_ref,
    purpose_code: row.purpose_code,
    source_event_type: row.source_event_type,
    source_aggregate_type: row.source_aggregate_type,
    source_schema_version: row.source_schema_version,
    aggregation: row.aggregation,
    value_field: row.value_field,
    period_granularity: row.period_granularity,
    dimensions: row.dimensions,
    min_cohort_size: row.min_cohort_size,
  };
}

/** Contract-conformant projection (SF-CON-ANALYTICS-METRIC). `period_end` is the exclusive bucket end. */
export function metricView(row: MetricPointRow, correlationId: string): Record<string, unknown> {
  return {
    contract_id: 'SF-CON-ANALYTICS-METRIC',
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    tenant_id: row.tenant_id,
    metric_id: row.metric_id,
    metric_code: row.metric_code,
    period_start: row.period_start,
    period_end: row.period_end,
    value: row.value,
    dimensions: row.dimensions,
    aggregate_only: true,
    raw_pii_payload_forbidden: true,
    purpose_code: row.purpose_code,
    correlation_id: correlationId,
  };
}

function definitionEventData(row: DefinitionRow): Record<string, unknown> {
  return {
    definition_id: row.definition_id,
    metric_code: row.metric_code,
    version_no: row.version_no,
    purpose_code: row.purpose_code,
    source_event_type: row.source_event_type,
    aggregation: row.aggregation,
    period_granularity: row.period_granularity,
    min_cohort_size: row.min_cohort_size,
  };
}

function wrapProjection(err: unknown): never {
  if (err instanceof ProjectionError) {
    throw new Cmp045Error('SF-SYS-003', detail(err.code, '/data'));
  }
  throw err;
}

export class AnalyticsService {
  private readonly maxFutureSkewMs: number;
  private readonly batchSize: number;
  private readonly maxBatches: number;
  private readonly leaseMs: number;

  constructor(private readonly deps: AnalyticsServiceDeps) {
    this.maxFutureSkewMs = deps.maxFutureSkewMs ?? DEFAULT_MAX_FUTURE_SKEW_MS;
    this.batchSize = deps.rebuildBatchSize ?? DEFAULT_REBUILD_BATCH_SIZE;
    this.maxBatches = deps.maxRebuildBatches ?? DEFAULT_MAX_REBUILD_BATCHES;
    this.leaseMs = deps.rebuildLeaseMs ?? DEFAULT_REBUILD_LEASE_MS;
  }

  private async guard(
    ctx: TenantContext,
    action: AnalyticsAction,
    resourceType: string,
  ): Promise<void> {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp045Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
    await authorize(this.deps.authorizer, authzInput(ctx, action, resourceType));
  }

  private async idempotent(
    ctx: TenantContext,
    idem: Idempotency,
    fn: (tx: AnalyticsTx, now: Date) => Promise<CommandResult>,
  ): Promise<CommandResult> {
    const now = this.deps.clock();
    return this.deps.repo.withTx(ctx, async (tx) => {
      const claim = await tx.claimIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        fingerprint: idem.fingerprint,
        now,
      });
      if (claim !== 'claimed') return claim;
      const result = await fn(tx, now);
      await tx.completeIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        status: result.status,
        body: result.body,
      });
      return result;
    });
  }

  private async emit(
    tx: AnalyticsTx,
    ctx: TenantContext,
    eventType: DomainEventType,
    aggregateId: string,
    aggregateVersion: number,
    data: object,
    now: Date,
  ): Promise<void> {
    await tx.insertOutbox(
      envelopeOf({
        eventType,
        tenantId: ctx.tenant_id,
        cellId: ctx.cell_id,
        aggregateType: 'MetricDefinition',
        aggregateId,
        aggregateVersion,
        occurredAt: now.toISOString(),
        correlationId: ctx.correlation_id,
        actor: ctx.actor,
        data,
      }),
      TOPIC_DOMAIN,
    );
  }

  async createDefinition(
    ctx: TenantContext,
    input: DefinitionInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    await this.guard(ctx, ANALYTICS_ACTIONS.definitionCreate, 'MetricDefinition');
    return this.idempotent(ctx, idem, async (tx, now) => {
      const row: DefinitionRow = {
        definition_id: randomUUID(),
        metric_code: input.metric_code,
        version_no: (await tx.latestDefinitionVersion(input.metric_code)) + 1,
        status: 'PUBLISHED',
        publication_ref: input.publication_ref,
        purpose_code: input.purpose_code,
        source_event_type: input.source_event_type,
        source_aggregate_type: input.source_aggregate_type,
        source_schema_version: input.source_schema_version,
        aggregation: input.aggregation,
        value_field: input.value_field,
        period_granularity: input.period_granularity,
        dimensions: input.dimensions.map((d) => ({ ...d })),
        min_cohort_size: input.min_cohort_size,
        created_at: now.toISOString(),
      };
      await tx.insertDefinition({ ...row, created_by: ctx.actor.id });
      await tx.insertState(row.definition_id, now);
      await this.emit(
        tx,
        ctx,
        'AnalyticsMetricDefinitionPublished',
        row.definition_id,
        row.version_no,
        definitionEventData(row),
        now,
      );
      await appendAudit(tx, ctx, {
        action: 'ANALYTICS_DEFINITION_CREATE',
        actionClass: 'WRITE',
        resourceType: 'MetricDefinition',
        resourceId: row.definition_id,
        result: 'SUCCESS',
        now,
      });
      return { status: 201, body: { definition: definitionView(row) } };
    });
  }

  async retireDefinition(
    ctx: TenantContext,
    definitionId: string,
    idem: Idempotency,
  ): Promise<CommandResult> {
    await this.guard(ctx, ANALYTICS_ACTIONS.definitionRetire, 'MetricDefinition');
    return this.idempotent(ctx, idem, async (tx, now) => {
      const row = await tx.getDefinition(definitionId);
      if (!row) throw new Cmp045Error('SF-SYS-002');
      if (row.status !== 'PUBLISHED') {
        throw new Cmp045Error('SF-APP-001', detail('DEFINITION_NOT_PUBLISHED'));
      }
      await tx.retireDefinition(definitionId, now);
      await this.emit(
        tx,
        ctx,
        'AnalyticsMetricDefinitionRetired',
        row.definition_id,
        row.version_no,
        definitionEventData(row),
        now,
      );
      await appendAudit(tx, ctx, {
        action: 'ANALYTICS_DEFINITION_RETIRE',
        actionClass: 'WRITE',
        resourceType: 'MetricDefinition',
        resourceId: definitionId,
        result: 'SUCCESS',
        now,
      });
      return { status: 200, body: { definition: definitionView({ ...row, status: 'RETIRED' }) } };
    });
  }

  async getDefinition(ctx: TenantContext, definitionId: string): Promise<CommandResult> {
    await this.guard(ctx, ANALYTICS_ACTIONS.definitionRead, 'MetricDefinition');
    const row = await this.deps.repo.withTx(ctx, (tx) => tx.getDefinition(definitionId));
    if (!row) throw new Cmp045Error('SF-SYS-002');
    return { status: 200, body: { definition: definitionView(row) } };
  }

  async listDefinitions(ctx: TenantContext, metricCode: string | null): Promise<CommandResult> {
    await this.guard(ctx, ANALYTICS_ACTIONS.definitionRead, 'MetricDefinition');
    const rows = await this.deps.repo.withTx(ctx, (tx) => tx.listDefinitions(metricCode));
    return { status: 200, body: { definitions: rows.map(definitionView) } };
  }

  /**
   * Event handler for the CMP-038 subscription. Tenant and cell come from the validated envelope
   * (SF-CON-DB-SESSION-CONTEXT: background workers derive context from the unit of work), never
   * from a caller header. Duplicate delivery is a no-op; a schema-version mismatch fails explicitly.
   */
  async ingest(
    raw: unknown,
    traceId: string = randomUUID().replaceAll('-', ''),
  ): Promise<IngestResult> {
    const envelope = parseEnvelope(raw);
    const now = this.deps.clock();
    if (Date.parse(envelope.occurred_at) > now.getTime() + this.maxFutureSkewMs) {
      throw new Cmp045Error('SF-SYS-003', detail('EVENT_TIME_IN_FUTURE', '/occurred_at'));
    }
    const ctx: TenantContext = {
      tenant_id: envelope.tenant_id as string,
      cell_id: envelope.cell_id,
      actor: { type: 'SYSTEM', id: this.deps.consumerActorId },
      roles: ['ANALYTICS_PROJECTOR'],
      jurisdiction_ids: [],
      auth_assurance: 'WORKLOAD_IDENTITY',
      correlation_id: envelope.correlation_id,
      trace_id: traceId,
    };
    await this.guard(ctx, ANALYTICS_ACTIONS.eventIngest, 'AnalyticsProjection');
    return this.deps.repo.withTx(ctx, async (tx) => {
      const result: IngestResult = {
        event_id: envelope.event_id,
        duplicate_delivery: false,
        matched_definitions: 0,
        contributions_applied: 0,
        contributions_duplicate: 0,
        unclassified_dimensions: 0,
      };
      if (!(await tx.claimInbox(INGEST_CONSUMER_GROUP, envelope.event_id))) {
        result.duplicate_delivery = true;
        return result;
      }
      const definitions = (await tx.listPublishedForEvent(envelope.event_type)).filter((d) =>
        matchesDefinition(specOf(d), envelope),
      );
      result.matched_definitions = definitions.length;
      for (const definition of definitions) {
        const state = await tx.getState(definition.definition_id, { shared: true });
        if (!state) throw new Cmp045Error('SF-SYS-001', detail('PROJECTION_STATE_MISSING'));
        const generations = [state.active_generation];
        if (state.building_generation !== null) generations.push(state.building_generation);
        const outcome = await this.applyEvent(tx, ctx, definition, generations, envelope, now);
        result.contributions_applied += outcome.applied;
        result.contributions_duplicate += outcome.duplicate;
        result.unclassified_dimensions += outcome.unclassified;
      }
      return result;
    });
  }

  private async applyEvent(
    tx: AnalyticsTx,
    ctx: TenantContext,
    definition: DefinitionRow,
    generations: readonly number[],
    envelope: EventEnvelope<Record<string, unknown>>,
    now: Date,
  ): Promise<{ applied: number; duplicate: number; unclassified: number }> {
    let contribution;
    try {
      contribution = contributionOf(specOf(definition), envelope);
    } catch (err) {
      return wrapProjection(err);
    }
    const out = { applied: 0, duplicate: 0, unclassified: 0 };
    for (const generation of generations) {
      const status = await tx.applyContribution({
        definition_id: definition.definition_id,
        generation,
        event_id: envelope.event_id,
        metric_code: definition.metric_code,
        purpose_code: definition.purpose_code,
        period_start: contribution.period_start,
        period_end: contribution.period_end,
        dimensions: contribution.dimensions,
        dimension_hash: contribution.dimension_hash,
        metric_id: metricPointId(
          ctx.tenant_id,
          definition.definition_id,
          contribution.period_start,
          contribution.dimension_hash,
        ),
        delta: contribution.delta,
        contributor_increment: 1,
        occurred_at: envelope.occurred_at,
        now,
      });
      if (status === 'applied') {
        out.applied += 1;
        out.unclassified += contribution.unclassified_dimensions;
      } else out.duplicate += 1;
    }
    return out;
  }

  async queryMetrics(ctx: TenantContext, query: ParsedMetricQuery): Promise<CommandResult> {
    await this.guard(ctx, ANALYTICS_ACTIONS.metricRead, 'AnalyticsMetric');
    const declared = ctx.purpose ?? query.purpose_code;
    if (declared === null || declared === undefined) {
      throw new Cmp045Error('SF-SYS-003', detail('PURPOSE_REQUIRED', '/query/purpose_code'));
    }
    if (
      ctx.purpose !== undefined &&
      query.purpose_code !== null &&
      query.purpose_code !== ctx.purpose
    ) {
      await this.auditRead(ctx, 'DENIED', 'PURPOSE_MISMATCH');
      throw new Cmp045Error('SF-AUTH-002', detail('PURPOSE_NOT_PERMITTED'));
    }
    const now = this.deps.clock();
    const outcome = await this.deps.repo.withTx(ctx, async (tx) => {
      const all = await tx.listDefinitions(query.metric_code);
      if (all.length === 0) return { kind: 'NOT_FOUND' as const };
      const permitted = all.filter((d) => d.purpose_code === declared);
      if (permitted.length === 0) return { kind: 'PURPOSE_DENIED' as const, anchor: all[0] };
      const anchor = permitted[permitted.length - 1] as DefinitionRow;
      const points = await tx.queryPoints({
        definition_ids: permitted.map((d) => d.definition_id),
        period_from: query.period_from,
        period_to: query.period_to,
        dimensions: query.dimensions as Record<string, string>,
        limit: query.limit,
      });
      const byId = new Map(permitted.map((d) => [d.definition_id, d]));
      const visible: { point: MetricPointRow; definition: DefinitionRow }[] = [];
      let suppressed = 0;
      for (const point of points) {
        const definition = byId.get(point.definition_id) as DefinitionRow;
        if (point.contributor_count < definition.min_cohort_size) suppressed += 1;
        else visible.push({ point, definition });
      }
      await appendAudit(tx, ctx, {
        action: 'ANALYTICS_METRIC_READ',
        actionClass: 'READ',
        resourceType: 'AnalyticsMetric',
        resourceId: anchor.definition_id,
        result: 'SUCCESS',
        now,
      });
      return { kind: 'OK' as const, visible, suppressed };
    });
    if (outcome.kind === 'NOT_FOUND') throw new Cmp045Error('SF-SYS-002');
    if (outcome.kind === 'PURPOSE_DENIED') {
      await this.auditRead(ctx, 'DENIED', 'PURPOSE_NOT_PERMITTED', outcome.anchor?.definition_id);
      throw new Cmp045Error('SF-AUTH-002', detail('PURPOSE_NOT_PERMITTED'));
    }
    return {
      status: 200,
      body: {
        metrics: outcome.visible.map(({ point, definition }) => ({
          metric: metricView(point, ctx.correlation_id),
          detail: {
            definition_id: definition.definition_id,
            definition_version: definition.version_no,
            contributor_count: point.contributor_count,
            last_event_at: point.last_event_at,
          },
        })),
        suppressed_count: outcome.suppressed,
      },
    };
  }

  private async auditRead(
    ctx: TenantContext,
    result: 'DENIED' | 'FAILED',
    reason: string,
    resourceId: string = ctx.tenant_id,
  ): Promise<void> {
    try {
      const now = this.deps.clock();
      await this.deps.repo.withTx(ctx, (tx) =>
        appendAudit(tx, ctx, {
          action: 'ANALYTICS_METRIC_READ',
          actionClass: 'READ',
          resourceType: 'AnalyticsMetric',
          resourceId,
          result,
          reason,
          now,
        }),
      );
    } catch {
      // The refusal is already surfaced to the caller; audit is best effort on this path.
    }
  }

  /**
   * Rebuilds a definition's projection from the replay source into a new generation and swaps it in
   * atomically (INT-010). Replay reads happen outside any transaction; each batch is one short
   * transaction. Live events keep applying to both generations while the build runs.
   */
  async rebuild(
    ctx: TenantContext,
    definitionId: string,
    idem: Idempotency,
  ): Promise<CommandResult> {
    await this.guard(ctx, ANALYTICS_ACTIONS.projectionRebuild, 'AnalyticsProjection');
    const token = randomUUID();
    const started = await this.deps.repo.withTx(ctx, async (tx) => {
      const now = this.deps.clock();
      const claim = await tx.claimIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        fingerprint: idem.fingerprint,
        now,
      });
      if (claim !== 'claimed') return { replayed: claim } as const;
      const definition = await tx.getDefinition(definitionId);
      if (!definition) throw new Cmp045Error('SF-SYS-002');
      if (definition.status !== 'PUBLISHED') {
        throw new Cmp045Error('SF-APP-001', detail('DEFINITION_NOT_PUBLISHED'));
      }
      const generation = await tx.beginBuild({
        definitionId,
        token,
        now,
        leaseMs: this.leaseMs,
      });
      return { definition, generation } as const;
    });
    if ('replayed' in started) return started.replayed;
    const { definition, generation } = started;

    let cursor: string | null = null;
    let batches = 0;
    let applied = 0;
    let duplicate = 0;
    do {
      batches += 1;
      if (batches > this.maxBatches) {
        throw new Cmp045Error('SF-SYS-004', detail('REBUILD_LIMIT_EXCEEDED'));
      }
      let batch;
      try {
        batch = await this.deps.replay.readBatch({
          tenant_id: ctx.tenant_id,
          event_type: definition.source_event_type,
          aggregate_type: definition.source_aggregate_type,
          cursor,
          limit: this.batchSize,
        });
      } catch (err) {
        if (err instanceof Cmp045Error) throw err;
        throw new Cmp045Error('SF-INT-001', {
          details: [{ code: 'REPLAY_SOURCE_FAILED' }],
          cause: err,
        });
      }
      const events = batch.events.map((e) => parseEnvelope(e));
      for (const event of events) {
        if (event.tenant_id !== ctx.tenant_id) throw new Cmp045Error('SF-TEN-002');
      }
      const counts = await this.deps.repo.withTx(ctx, async (tx) => {
        const now = this.deps.clock();
        await tx.renewBuild({ definitionId, token, now, leaseMs: this.leaseMs });
        let a = 0;
        let d = 0;
        for (const event of events) {
          if (!matchesDefinition(specOf(definition), event)) continue;
          const out = await this.applyEvent(tx, ctx, definition, [generation], event, now);
          a += out.applied;
          d += out.duplicate;
        }
        return { a, d };
      });
      applied += counts.a;
      duplicate += counts.d;
      cursor = batch.next_cursor;
    } while (cursor !== null);

    return this.deps.repo.withTx(ctx, async (tx) => {
      const now = this.deps.clock();
      const activated = await tx.activateBuild({ definitionId, token, now });
      await this.emit(
        tx,
        ctx,
        'AnalyticsProjectionRebuilt',
        definition.definition_id,
        definition.version_no,
        {
          ...definitionEventData(definition),
          generation: activated,
          events_applied: applied,
          events_duplicate: duplicate,
        },
        now,
      );
      await appendAudit(tx, ctx, {
        action: 'ANALYTICS_PROJECTION_REBUILD',
        actionClass: 'WRITE',
        resourceType: 'AnalyticsProjection',
        resourceId: definition.definition_id,
        result: 'SUCCESS',
        now,
      });
      const body = {
        definition_id: definition.definition_id,
        active_generation: activated,
        events_applied: applied,
        events_duplicate: duplicate,
      };
      await tx.completeIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        status: 200,
        body,
      });
      return { status: 200, body };
    });
  }
}
