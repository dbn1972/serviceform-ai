import type {
  AuthzDecisionInput,
  AuthzDecisionOutput,
  RequestContext,
} from '@serviceform/contracts';
import { insertOutboxEvent, OutboxError, withOutboxTransaction } from '@serviceform/outbox';
import type pg from 'pg';

export interface AuthorizationPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

export interface OperatorAction {
  kind: 'replay' | 'discard';
  schema: string;
  table: string;
  seq: string;
  reason: string;
}

export async function auditThenAct(
  pool: pg.Pool,
  ctx: RequestContext,
  authz: AuthorizationPort,
  action: OperatorAction,
  apply: () => Promise<number>,
): Promise<void> {
  if (ctx.actor.type !== 'PRIVILEGED_ADMIN') {
    throw new OutboxError('SF-AUTH-002');
  }
  if (ctx.auth_assurance !== 'MFA') {
    throw new OutboxError('SF-AUTH-002', { details: [{ code: 'MFA_REQUIRED' }] });
  }
  if (!action.reason.trim()) {
    throw new OutboxError('SF-SYS-003', { details: [{ code: 'REASON_REQUIRED' }] });
  }
  const decision = await authz.decide({
    subject: {
      user_id: ctx.actor.id,
      actor_type: ctx.actor.type,
      tenant_id: ctx.tenant_id,
      roles: ctx.roles,
      jurisdiction_ids: ctx.jurisdiction_ids,
      assurance: ctx.auth_assurance,
    },
    resource: { resource_type: 'OutboxDeadLetter', tenant_id: ctx.tenant_id },
    action: action.kind === 'replay' ? 'outbox.replay' : 'outbox.discard',
  });
  if (!decision.allow) {
    throw new OutboxError('SF-AUTH-002');
  }
  await withOutboxTransaction(pool, ctx, async (tx) => {
    const eventType = action.kind === 'replay' ? 'DeadLetterReplayed' : 'DeadLetterDiscarded';
    await insertOutboxEvent(tx, {
      schema: 'sf_event_bus',
      topic: 'sf.eventbus.platform.v1',
      platformAllowlist: ['DeadLetterReplayed', 'DeadLetterDiscarded', 'AuditEventSubmitted'],
      envelope: {
        event_id: crypto.randomUUID(),
        event_type: eventType,
        schema_version: 1,
        tenant_id: null,
        cell_id: ctx.cell_id,
        aggregate_type: 'OutboxDeadLetter',
        aggregate_id: crypto.randomUUID(),
        aggregate_version: 1,
        occurred_at: new Date().toISOString(),
        correlation_id: ctx.correlation_id,
        actor: ctx.actor,
        data: {
          seq: action.seq,
          schema: action.schema,
          table: action.table,
          reason: action.reason,
        },
      },
    });
    await insertOutboxEvent(tx, {
      schema: 'sf_event_bus',
      topic: 'sf.audit.ingest.v1',
      platformAllowlist: ['AuditEventSubmitted'],
      envelope: {
        event_id: crypto.randomUUID(),
        event_type: 'AuditEventSubmitted',
        schema_version: 1,
        tenant_id: null,
        cell_id: ctx.cell_id,
        aggregate_type: 'AuditEvent',
        aggregate_id: crypto.randomUUID(),
        aggregate_version: 1,
        occurred_at: new Date().toISOString(),
        correlation_id: ctx.correlation_id,
        actor: ctx.actor,
        data: {
          audit_id: crypto.randomUUID(),
          occurred_at: new Date().toISOString(),
          tenant_id: null,
          cell_id: ctx.cell_id,
          actor_type: ctx.actor.type,
          actor_id: ctx.actor.id,
          action: action.kind,
          action_class: 'PRIVILEGED',
          resource_type: 'OutboxDeadLetter',
          resource_id: action.seq,
          reason: action.reason,
          correlation_id: ctx.correlation_id,
          trace_id: ctx.trace_id,
          result: 'SUCCESS',
        },
      },
    });
  });
  await apply();
}
