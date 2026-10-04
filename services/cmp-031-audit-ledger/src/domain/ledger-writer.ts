import { randomUUID } from 'node:crypto';
import { GENESIS_HASH_HEX, hashChainRow, hashEvent, toHex } from '@serviceform/audit-client';
import type { AuditEvent, EventEnvelope, RequestContext } from '@serviceform/contracts';
import type { PoolClient } from 'pg';
import { AuditError, DuplicateContentError } from './errors.js';
import {
  findPlatformKey,
  findTenantKey,
  insertPlatformLedger,
  insertTenantLedger,
  lockPlatformHead,
  lockTenantHead,
  nextRecordedAt,
  updatePlatformHead,
  updateTenantHead,
} from '../repo/ledger-repo.js';
import { insertAuditRecordCreated } from '../repo/outbox-repo.js';

export interface AppendResult {
  audit_id: string;
  chain_seq: number;
  recorded_at: string;
  duplicate: boolean;
}

function stripStored(event: AuditEvent): AuditEvent {
  const { client_context: _drop, ...rest } = event;
  return rest;
}

function recordedIso(d: Date): string {
  return d.toISOString();
}

function createdEnvelope(event: AuditEvent, chainSeq: number, recordedAt: string): EventEnvelope {
  const data: Record<string, unknown> = {
    audit_id: event.audit_id,
    chain_seq: chainSeq,
    recorded_at: recordedAt,
    action: event.action,
    resource_type: event.resource_type,
    result: event.result,
  };
  if (event.action_class !== undefined) data['action_class'] = event.action_class;
  return {
    event_id: randomUUID(),
    event_type: 'AuditRecordCreated',
    schema_version: 1,
    tenant_id: event.tenant_id,
    cell_id: event.cell_id,
    aggregate_type: 'AuditEvent',
    aggregate_id: event.audit_id,
    aggregate_version: chainSeq,
    occurred_at: recordedAt,
    correlation_id: event.correlation_id,
    actor: { type: event.actor_type, id: event.actor_id },
    data,
  };
}

export async function appendLedger(
  client: PoolClient,
  ctx: RequestContext,
  event: AuditEvent,
): Promise<AppendResult> {
  if (ctx.tenant_id !== event.tenant_id) {
    throw new AuditError('SF-TEN-002');
  }
  const stored = stripStored(event);
  const contentHash = hashEvent(stored);
  if (stored.tenant_id === null) {
    const existing = await findPlatformKey(client, stored.audit_id);
    if (existing) {
      if (!existing.content_hash.equals(contentHash)) {
        throw new DuplicateContentError(stored.audit_id);
      }
      return {
        audit_id: stored.audit_id,
        chain_seq: Number(existing.chain_seq),
        recorded_at: existing.recorded_at.toISOString(),
        duplicate: true,
      };
    }
    const head = await lockPlatformHead(client);
    const again = await findPlatformKey(client, stored.audit_id);
    if (again) {
      if (!again.content_hash.equals(contentHash)) throw new DuplicateContentError(stored.audit_id);
      return {
        audit_id: stored.audit_id,
        chain_seq: Number(again.chain_seq),
        recorded_at: again.recorded_at.toISOString(),
        duplicate: true,
      };
    }
    const seq = Number(head.last_seq) + 1;
    const recordedAt = await nextRecordedAt(client, head.last_recorded_at);
    const recordedAtIso = recordedIso(recordedAt);
    const prevHex = toHex(head.last_hash);
    const rowHash = hashChainRow({
      tenant_id: null,
      chain_seq: seq,
      recorded_at: recordedAtIso,
      audit_id: stored.audit_id,
      event: stored,
      prev_hash_hex: prevHex.length === 0 ? GENESIS_HASH_HEX : prevHex,
    });
    await insertPlatformLedger(client, {
      chainSeq: seq,
      recordedAt,
      auditId: stored.audit_id,
      record: stored,
      prevHash: head.last_hash,
      rowHash,
      contentHash,
    });
    await updatePlatformHead(client, seq, rowHash, recordedAt);
    await insertAuditRecordCreated(client, createdEnvelope(stored, seq, recordedAtIso));
    return {
      audit_id: stored.audit_id,
      chain_seq: seq,
      recorded_at: recordedAtIso,
      duplicate: false,
    };
  }

  const tenantId = stored.tenant_id;
  const existing = await findTenantKey(client, tenantId, stored.audit_id);
  if (existing) {
    if (!existing.content_hash.equals(contentHash)) {
      throw new DuplicateContentError(stored.audit_id);
    }
    return {
      audit_id: stored.audit_id,
      chain_seq: Number(existing.chain_seq),
      recorded_at: existing.recorded_at.toISOString(),
      duplicate: true,
    };
  }
  const head = await lockTenantHead(client, tenantId);
  const again = await findTenantKey(client, tenantId, stored.audit_id);
  if (again) {
    if (!again.content_hash.equals(contentHash)) throw new DuplicateContentError(stored.audit_id);
    return {
      audit_id: stored.audit_id,
      chain_seq: Number(again.chain_seq),
      recorded_at: again.recorded_at.toISOString(),
      duplicate: true,
    };
  }
  const seq = Number(head.last_seq) + 1;
  const recordedAt = await nextRecordedAt(client, head.last_recorded_at);
  const recordedAtIso = recordedIso(recordedAt);
  const prevHex = toHex(head.last_hash);
  const rowHash = hashChainRow({
    tenant_id: tenantId,
    chain_seq: seq,
    recorded_at: recordedAtIso,
    audit_id: stored.audit_id,
    event: stored,
    prev_hash_hex: prevHex,
  });
  await insertTenantLedger(client, {
    tenantId,
    chainSeq: seq,
    recordedAt,
    auditId: stored.audit_id,
    record: stored,
    prevHash: head.last_hash,
    rowHash,
    contentHash,
  });
  await updateTenantHead(client, tenantId, seq, rowHash, recordedAt);
  await insertAuditRecordCreated(client, createdEnvelope(stored, seq, recordedAtIso));
  return {
    audit_id: stored.audit_id,
    chain_seq: seq,
    recorded_at: recordedAtIso,
    duplicate: false,
  };
}
