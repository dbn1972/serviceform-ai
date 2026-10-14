import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import { authorize, authzInput, type AuthorizationPort } from '../authz.js';
import { collectionResourceId } from '../domain/ids.js';
import {
  evaluateCommand,
  SUCCESSOR_ELIGIBLE_STATUSES,
  toContract,
  type RegistryCommand,
  type RegistryEntryRecord,
  type StatusHistoryRecord,
} from '../domain/status.js';
import { Cmp024Error, detail, type ErrorCode } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN, type DomainEventType } from '../outbox.js';
import type { RegistryReadTx, RegistryRepository, RegistryTx } from '../repo/types.js';
import type { TenantContext } from '../types.js';
import type { RegisterInput, TransitionInput } from './input.js';

export interface RegistryServiceDeps {
  repo: RegistryRepository;
  authorizer: AuthorizationPort;
  clock: () => Date;
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

export const RESOURCE_TYPE = 'CredentialRegistryEntry';

type ActorType = TenantContext['actor']['type'];
/** Registration is the credential engine's workload hand-off, never a person or a citizen. */
const REGISTER_ACTORS: readonly ActorType[] = ['SYSTEM'];
const LIFECYCLE_ACTORS: readonly ActorType[] = ['OFFICER', 'PRIVILEGED_ADMIN', 'SYSTEM'];
/** Citizens and the public verify through CMP-023 tokens, not this tenant-internal read. */
const READ_ACTORS: readonly ActorType[] = ['OFFICER', 'PRIVILEGED_ADMIN', 'SYSTEM', 'INTEGRATION'];

export const ACTIONS = {
  register: 'CREDENTIAL_REGISTRY_REGISTER',
  read: 'CREDENTIAL_REGISTRY_STATUS_READ',
  command: (c: RegistryCommand): string => `CREDENTIAL_REGISTRY_${c}`,
} as const;

/** A business refusal that must leave an audit trail even though its transaction rolls back. */
class AuditedRefusal extends Cmp024Error {
  constructor(
    code: ErrorCode,
    readonly reason: string,
    readonly action: string,
    readonly resourceId: string,
  ) {
    super(code, detail(reason));
  }
}

export function statusView(
  entry: RegistryEntryRecord,
  history: readonly StatusHistoryRecord[],
): Record<string, unknown> {
  return { credential_status: toContract(entry, history), status_version: entry.status_version };
}

/** The only capability handed to read ports: one lookup, no mutators. */
export interface CredentialStatusReader {
  readStatus(ctx: TenantContext, credentialId: string): Promise<CommandResult>;
}

export class CredentialRegistryService implements CredentialStatusReader {
  constructor(private readonly deps: RegistryServiceDeps) {}

  private assertNotInTx(): void {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp024Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
  }

  /** PEP call on OPA; a denial is audited as DENIED, a PDP outage fails closed (503). */
  private async guard(
    ctx: TenantContext,
    action: string,
    resourceId: string,
    actors: readonly ActorType[],
  ): Promise<void> {
    this.assertNotInTx();
    if (!actors.includes(ctx.actor.type)) {
      await this.auditOutcome(ctx, action, resourceId, 'DENIED', 'ACTOR_NOT_PERMITTED');
      throw new Cmp024Error('SF-AUTH-002', detail('ACTOR_NOT_PERMITTED'));
    }
    try {
      await authorize(this.deps.authorizer, authzInput(ctx, action, RESOURCE_TYPE));
    } catch (err) {
      if (err instanceof Cmp024Error && err.code === 'SF-AUTH-002') {
        await this.auditOutcome(ctx, action, resourceId, 'DENIED');
      }
      throw err;
    }
  }

  private async auditOutcome(
    ctx: TenantContext,
    action: string,
    resourceId: string,
    result: 'DENIED' | 'FAILED',
    reason?: string,
  ): Promise<void> {
    const now = this.deps.clock();
    await this.deps.repo.withTx(ctx, (tx) =>
      appendAudit(tx, ctx, {
        action,
        actionClass: action === ACTIONS.read ? 'READ' : 'WRITE',
        resourceType: RESOURCE_TYPE,
        resourceId,
        result,
        ...(reason === undefined ? {} : { reason }),
        now,
      }),
    );
  }

  /** One idempotent command; an AuditedRefusal rolls back and is then audited as FAILED. */
  private async command(
    ctx: TenantContext,
    idem: Idempotency,
    run: (tx: RegistryTx, now: Date) => Promise<CommandResult>,
  ): Promise<CommandResult> {
    const now = this.deps.clock();
    try {
      return await this.deps.repo.withTx(ctx, async (tx) => {
        const claim = await tx.claimIdempotency({
          principalId: ctx.actor.id,
          endpoint: idem.endpoint,
          key: idem.key,
          fingerprint: idem.fingerprint,
          now,
        });
        if (claim !== 'claimed') return claim;
        const result = await run(tx, now);
        await tx.completeIdempotency({
          principalId: ctx.actor.id,
          endpoint: idem.endpoint,
          key: idem.key,
          status: result.status,
          body: result.body,
        });
        return result;
      });
    } catch (err) {
      if (err instanceof AuditedRefusal) {
        await this.auditOutcome(ctx, err.action, err.resourceId, 'FAILED', err.reason);
      }
      throw err;
    }
  }

  private async emit(
    tx: RegistryTx,
    ctx: TenantContext,
    p: { eventType: DomainEventType; entry: RegistryEntryRecord; now: Date; data: object },
  ): Promise<void> {
    await tx.insertOutbox(
      envelopeOf({
        eventType: p.eventType,
        tenantId: ctx.tenant_id,
        cellId: ctx.cell_id,
        aggregateType: RESOURCE_TYPE,
        aggregateId: p.entry.credential_id,
        aggregateVersion: p.entry.status_version,
        occurredAt: p.now.toISOString(),
        correlationId: ctx.correlation_id,
        actor: ctx.actor,
        data: p.data,
      }),
      TOPIC_DOMAIN,
    );
  }

  private historyRow(
    ctx: TenantContext,
    entry: RegistryEntryRecord,
    from: StatusHistoryRecord['from_status'],
    reasonCodeRef: string | null,
  ): StatusHistoryRecord {
    return {
      tenant_id: ctx.tenant_id,
      entry_id: randomUUID(),
      credential_id: entry.credential_id,
      sequence: entry.status_version,
      from_status: from,
      to_status: entry.current_status,
      reason_code_ref: reasonCodeRef,
      superseded_by_credential_id: entry.superseded_by_credential_id,
      actor_type: ctx.actor.type,
      actor_id: ctx.actor.id,
      correlation_id: ctx.correlation_id,
      changed_at: entry.updated_at,
    };
  }

  async register(
    ctx: TenantContext,
    input: RegisterInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    await this.guard(
      ctx,
      ACTIONS.register,
      collectionResourceId(ctx.tenant_id, 'CREDENTIALS'),
      REGISTER_ACTORS,
    );
    return this.command(ctx, idem, async (tx, now) => {
      if (await tx.getEntry(input.credential_id)) {
        throw new Cmp024Error('SF-APP-002', detail('CREDENTIAL_ALREADY_REGISTERED'));
      }
      const nowIso = now.toISOString();
      const entry: RegistryEntryRecord = {
        tenant_id: ctx.tenant_id,
        credential_id: input.credential_id,
        issuer_ref: input.issuer_ref,
        current_status: 'REGISTERED',
        superseded_by_credential_id: null,
        status_version: 1,
        registered_at: nowIso,
        updated_at: nowIso,
        registered_by: ctx.actor.id,
        last_correlation_id: ctx.correlation_id,
      };
      await tx.insertEntry(entry);
      const first = this.historyRow(ctx, entry, null, null);
      await tx.insertHistory(first);
      await this.emit(tx, ctx, {
        eventType: 'CredentialRegistered',
        entry,
        now,
        data: {
          credential_id: entry.credential_id,
          issuer_ref: entry.issuer_ref,
          to_status: entry.current_status,
          sequence: 1,
          status_version: 1,
        },
      });
      await appendAudit(tx, ctx, {
        action: ACTIONS.register,
        actionClass: 'WRITE',
        resourceType: RESOURCE_TYPE,
        resourceId: entry.credential_id,
        result: 'SUCCESS',
        now,
      });
      return { status: 201, body: statusView(entry, [first]) };
    });
  }

  async transition(
    ctx: TenantContext,
    command: RegistryCommand,
    credentialId: string,
    input: TransitionInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    const action = ACTIONS.command(command);
    await this.guard(ctx, action, credentialId, LIFECYCLE_ACTORS);
    return this.command(ctx, idem, async (tx, now) => {
      const entry = await tx.getEntryForUpdate(credentialId);
      if (!entry) throw new Cmp024Error('SF-SYS-002', detail('CREDENTIAL_NOT_REGISTERED'));
      if (entry.status_version !== input.expected_version) {
        throw new Cmp024Error('SF-APP-001', detail('STALE_VERSION', '/expected_version'));
      }
      const verdict = evaluateCommand(command, entry.current_status);
      if (!verdict.allowed) {
        throw new AuditedRefusal('SF-APP-001', verdict.reason, action, credentialId);
      }
      if (command === 'REISSUE') {
        const successorId = input.superseded_by_credential_id;
        if (successorId === null || successorId === credentialId) {
          throw new AuditedRefusal('SF-APP-001', 'SUCCESSOR_INVALID', action, credentialId);
        }
        const successor = await tx.getEntry(successorId);
        if (!successor) {
          throw new AuditedRefusal('SF-APP-001', 'SUCCESSOR_NOT_REGISTERED', action, credentialId);
        }
        if (!SUCCESSOR_ELIGIBLE_STATUSES.includes(successor.current_status)) {
          throw new AuditedRefusal('SF-APP-001', 'SUCCESSOR_NOT_LIVE', action, credentialId);
        }
      }
      const from = entry.current_status;
      const next: RegistryEntryRecord = {
        ...entry,
        current_status: verdict.to,
        superseded_by_credential_id:
          command === 'REISSUE' ? input.superseded_by_credential_id : null,
        status_version: entry.status_version + 1,
        updated_at: now.toISOString(),
        last_correlation_id: ctx.correlation_id,
      };
      await tx.updateEntryStatus(next);
      await tx.insertHistory(this.historyRow(ctx, next, from, input.reason_code_ref));
      const data: Record<string, unknown> = {
        credential_id: next.credential_id,
        issuer_ref: next.issuer_ref,
        from_status: from,
        to_status: next.current_status,
        sequence: next.status_version,
        status_version: next.status_version,
      };
      if (input.reason_code_ref !== null) data['reason_code_ref'] = input.reason_code_ref;
      if (next.superseded_by_credential_id !== null) {
        data['superseded_by_credential_id'] = next.superseded_by_credential_id;
      }
      await this.emit(tx, ctx, { eventType: 'CredentialStatusChanged', entry: next, now, data });
      await appendAudit(tx, ctx, {
        action,
        actionClass: 'DECISION',
        resourceType: RESOURCE_TYPE,
        resourceId: credentialId,
        result: 'SUCCESS',
        reason: input.reason_code_ref ?? `${from}->${next.current_status}`,
        now,
      });
      return { status: 200, body: statusView(next, await tx.listHistory(credentialId)) };
    });
  }

  /** Read port: authorised, then served from a read-only transaction. Never mutates status. */
  async readStatus(ctx: TenantContext, credentialId: string): Promise<CommandResult> {
    await this.guard(ctx, ACTIONS.read, credentialId, READ_ACTORS);
    return this.deps.repo.withReadTx(ctx, (tx: RegistryReadTx) => readView(tx, credentialId));
  }
}

async function readView(tx: RegistryReadTx, credentialId: string): Promise<CommandResult> {
  const entry = await tx.getEntry(credentialId);
  if (!entry) throw new Cmp024Error('SF-SYS-002', detail('CREDENTIAL_NOT_REGISTERED'));
  return { status: 200, body: statusView(entry, await tx.listHistory(credentialId)) };
}

/**
 * Narrow, frozen capability for in-process read consumers (e.g. CMP-023 QR verification once
 * mounted). It exposes only getStatus; no reference to the command surface escapes.
 */
export function createCredentialStatusReadPort(reader: CredentialStatusReader): Readonly<{
  getStatus(ctx: TenantContext, credentialId: string): Promise<CommandResult>;
}> {
  return Object.freeze({
    getStatus: (ctx: TenantContext, credentialId: string) => reader.readStatus(ctx, credentialId),
  });
}
