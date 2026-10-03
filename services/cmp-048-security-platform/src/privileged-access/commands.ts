import { randomUUID } from 'node:crypto';
import type { AuditEvent, RequestContext } from '@serviceform/contracts';
import { SecurityError } from '@serviceform/security';
import type { Pool } from 'pg';
import { withTenantTx } from '../db/tx.js';
import { envelope } from '../events/envelopes.js';
import { writeOutbox } from '../events/outbox-writer.js';
import { complete, fingerprint, remember } from '../idempotency.js';
import type { GrantPublisher } from './grant-publisher.js';
import type { PrivilegedAccessRecord } from './model.js';
import * as repo from './repository.js';

const MAX_MS = 8 * 3600 * 1000;

function audit(ctx: RequestContext, action: string, resourceId: string): AuditEvent {
  return {
    audit_id: randomUUID(),
    occurred_at: new Date().toISOString(),
    tenant_id: ctx.tenant_id,
    cell_id: ctx.cell_id,
    actor_type: ctx.actor.type,
    actor_id: ctx.actor.id,
    action,
    action_class: 'PRIVILEGED',
    resource_type: 'PrivilegedAccess',
    resource_id: resourceId,
    reason: 'privileged_access_command',
    correlation_id: ctx.correlation_id,
    trace_id: ctx.trace_id,
    result: 'SUCCESS',
    classification: 'TENANT_SCOPED',
  };
}

export class PrivilegedAccessCommands {
  constructor(
    private readonly pool: Pool,
    private readonly publisher: GrantPublisher | undefined,
  ) {}

  async request(
    ctx: RequestContext,
    body: Omit<
      PrivilegedAccessRecord,
      'id' | 'requested_by' | 'requested_at' | 'status' | 'version' | 'tenant_id'
    > & {
      tenant_id?: string;
    },
    idempotencyKey?: string,
  ): Promise<{ id: string }> {
    if (!ctx.tenant_id) throw new SecurityError('SF-TEN-001', { statusCode: 401 });
    const start = Date.parse(body.starts_at);
    const end = Date.parse(body.expires_at);
    if (!(end > start) || end - start > MAX_MS)
      throw new SecurityError('SF-SYS-003', { statusCode: 400 });
    const id = randomUUID();
    await withTenantTx(this.pool, ctx, async (c) => {
      if (idempotencyKey) {
        const mem = await remember(c, {
          tenantId: ctx.tenant_id,
          principalId: ctx.actor.id,
          endpoint: 'POST /privileged-access',
          key: idempotencyKey,
          fingerprint: fingerprint(body),
        });
        if (mem.replay) return;
      }
      const row: PrivilegedAccessRecord = {
        ...body,
        id,
        tenant_id: ctx.tenant_id as string,
        requested_by: ctx.actor.id,
        requested_at: new Date().toISOString(),
        status: 'REQUESTED',
        version: 1,
      };
      await repo.insertRequested(c, row);
      const ev = envelope(ctx, {
        event_type: 'AuditEventSubmitted',
        aggregate_type: 'PrivilegedAccess',
        aggregate_id: id,
        aggregate_version: 1,
        tenant_id: ctx.tenant_id,
        data: audit(ctx, 'PRIVILEGED_ACCESS_REQUEST', id),
      });
      await writeOutbox(c, ev, 'sf.audit.ingest.v1');
      if (idempotencyKey) {
        await complete(c, {
          tenantId: ctx.tenant_id,
          principalId: ctx.actor.id,
          endpoint: 'POST /privileged-access',
          key: idempotencyKey,
          responseRef: id,
        });
      }
    });
    return { id };
  }

  async approve(ctx: RequestContext, id: string): Promise<PrivilegedAccessRecord> {
    if (!ctx.tenant_id) throw new SecurityError('SF-TEN-001', { statusCode: 401 });
    const row = await withTenantTx(this.pool, ctx, async (c) => {
      const current = await repo.getById(c, id);
      if (!current) throw new SecurityError('SF-SYS-002', { statusCode: 404 });
      await repo.approve(c, id, ctx.actor.id, current.version);
      const ev = envelope(ctx, {
        event_type: 'AuditEventSubmitted',
        aggregate_type: 'PrivilegedAccess',
        aggregate_id: id,
        aggregate_version: current.version + 1,
        tenant_id: ctx.tenant_id,
        data: audit(ctx, 'PRIVILEGED_ACCESS_APPROVE', id),
      });
      await writeOutbox(c, ev, 'sf.audit.ingest.v1');
      const next = await repo.getById(c, id);
      if (!next) throw new SecurityError('SF-SYS-002', { statusCode: 404 });
      return next;
    });
    if (this.publisher && row.status === 'APPROVED') {
      await this.publisher.push(row.tenant_id, row.grantee_user_id, {
        status: 'APPROVED',
        approved_by: row.approved_by ?? ctx.actor.id,
        grantee_user_id: row.grantee_user_id,
        tenant_id: row.tenant_id,
        starts_at: row.starts_at,
        expires_at: row.expires_at,
        scope_actions: row.scope_actions,
        scope_resource_types: row.scope_resource_types,
      });
    }
    return row;
  }

  async revoke(ctx: RequestContext, id: string): Promise<void> {
    if (!ctx.tenant_id) throw new SecurityError('SF-TEN-001', { statusCode: 401 });
    const row = await withTenantTx(this.pool, ctx, async (c) => {
      const current = await repo.getById(c, id);
      if (!current) throw new SecurityError('SF-SYS-002', { statusCode: 404 });
      await repo.revoke(c, id, ctx.actor.id, current.version);
      const ev = envelope(ctx, {
        event_type: 'AuditEventSubmitted',
        aggregate_type: 'PrivilegedAccess',
        aggregate_id: id,
        aggregate_version: current.version + 1,
        tenant_id: ctx.tenant_id,
        data: audit(ctx, 'PRIVILEGED_ACCESS_REVOKE', id),
      });
      await writeOutbox(c, ev, 'sf.audit.ingest.v1');
      return current;
    });
    if (this.publisher) {
      let last: unknown;
      for (let i = 0; i < 5; i += 1) {
        try {
          await this.publisher.remove(row.tenant_id, row.grantee_user_id);
          last = undefined;
          break;
        } catch (err) {
          last = err;
        }
      }
      if (last) {
        await withTenantTx(this.pool, ctx, async (c) => {
          const ev = envelope(ctx, {
            event_type: 'SecurityIncidentDetected',
            aggregate_type: 'SecurityIncident',
            aggregate_id: randomUUID(),
            aggregate_version: 1,
            tenant_id: ctx.tenant_id,
            data: { incident_code: 'GRANT_REVOKE_PUSH_FAILED', reason_code: 'PDP_UNAVAILABLE' },
          });
          await writeOutbox(c, ev, 'sf.security.events.v1');
        });
        throw last instanceof Error ? last : new Error('revoke push failed');
      }
    }
  }

  async review(ctx: RequestContext, id: string, outcome: string): Promise<void> {
    if (!ctx.tenant_id) throw new SecurityError('SF-TEN-001', { statusCode: 401 });
    await withTenantTx(this.pool, ctx, async (c) => {
      await repo.review(c, id, ctx.actor.id, outcome);
      const ev = envelope(ctx, {
        event_type: 'AuditEventSubmitted',
        aggregate_type: 'PrivilegedAccess',
        aggregate_id: id,
        aggregate_version: 1,
        tenant_id: ctx.tenant_id,
        data: audit(ctx, 'PRIVILEGED_ACCESS_REVIEW', id),
      });
      await writeOutbox(c, ev, 'sf.audit.ingest.v1');
    });
  }
}
