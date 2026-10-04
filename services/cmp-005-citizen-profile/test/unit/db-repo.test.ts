import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@serviceform/contracts';
import { envelopeOf, insertOutbox, TOPIC_AUDIT } from '../../src/db/outbox.js';
import { claimIdempotency, completeIdempotency } from '../../src/db/idempotency.js';
import { withContextTx } from '../../src/db/tx.js';
import {
  definitionExists,
  ensureProfile,
  getClaim,
  insertClaim,
  listClaims,
  serializeProfile,
  updateClaim,
} from '../../src/repositories/profile.repo.js';
import { createMemoryPool, emptyStore, T1, ACTOR_OFFICER } from './memory-pool.js';
import { valueSha256 } from '../../src/domain/fingerprint.js';

const ctx: RequestContext = {
  tenant_id: T1,
  cell_id: 'cell-01',
  actor: { type: 'OFFICER', id: ACTOR_OFFICER },
  roles: ['SERVICE_CHECKER'],
  jurisdiction_ids: [],
  auth_assurance: 'MFA',
  correlation_id: randomUUID(),
  trace_id: '0af7651916cd43dd8448eb211c80319c',
};

describe('repositories and db helpers', () => {
  it('ensures profile, writes claims, and serializes without values when hidden', async () => {
    const store = emptyStore();
    const pool = createMemoryPool(store);
    const now = new Date('2026-10-04T12:00:00.000Z');
    await withContextTx(pool, ctx, async (tx) => {
      expect(await definitionExists(tx, 'IDENTITY', 'DISPLAY_NAME')).toBe(true);
      const profile = await ensureProfile(tx, {
        tenantId: T1,
        subjectId: ACTOR_OFFICER,
        actorId: ACTOR_OFFICER,
        now,
      });
      const again = await ensureProfile(tx, {
        tenantId: T1,
        subjectId: ACTOR_OFFICER,
        actorId: ACTOR_OFFICER,
        now,
      });
      expect(again.profile_id).toBe(profile.profile_id);
      const sha = valueSha256('hidden');
      const created = await insertClaim(tx, {
        tenantId: T1,
        profileId: profile.profile_id,
        subjectId: ACTOR_OFFICER,
        section: 'IDENTITY',
        code: 'DISPLAY_NAME',
        valueSha: sha,
        valueText: 'hidden',
        sourceKind: 'SELF',
        connectorType: null,
        verification: 'UNVERIFIED',
        purposeCode: 'PROFILE_ACCESS',
        sourceRef: null,
        verifiedAt: null,
        simulation: null,
        now,
      });
      const updated = await updateClaim(tx, {
        tenantId: T1,
        claimId: created.claim_id,
        valueSha: sha,
        valueText: 'hidden',
        sourceKind: 'OFFICER',
        connectorType: null,
        verification: 'UNVERIFIED',
        purposeCode: 'PROFILE_ACCESS',
        sourceRef: null,
        verifiedAt: null,
        simulation: null,
        now,
      });
      expect(Number(updated.version)).toBeGreaterThan(1);
      const listed = await listClaims(tx, T1, profile.profile_id);
      expect(listed).toHaveLength(1);
      expect(await getClaim(tx, T1, profile.profile_id, 'IDENTITY', 'DISPLAY_NAME')).toBeTruthy();
      const hidden = serializeProfile(profile, listed, false);
      expect(hidden.claims[0]).not.toHaveProperty('value_text');
      const shown = serializeProfile(profile, listed, true);
      expect(shown.claims[0]).toHaveProperty('value_text');
      await claimIdempotency(tx, {
        tenantId: T1,
        principalId: ACTOR_OFFICER,
        endpoint: 'PUT /x',
        key: 'idem-aaaaaa',
        fingerprint: `sha256:${'b'.repeat(64)}`,
        now,
      });
      await completeIdempotency(tx, {
        tenantId: T1,
        principalId: ACTOR_OFFICER,
        endpoint: 'PUT /x',
        key: 'idem-aaaaaa',
        status: 200,
        body: { ok: true },
      });
      const replay = await claimIdempotency(tx, {
        tenantId: T1,
        principalId: ACTOR_OFFICER,
        endpoint: 'PUT /x',
        key: 'idem-aaaaaa',
        fingerprint: `sha256:${'b'.repeat(64)}`,
        now,
      });
      expect(replay).toMatchObject({ status: 200 });
      const env = envelopeOf({
        eventType: 'AuditEventSubmitted',
        tenantId: null,
        cellId: ctx.cell_id,
        aggregateType: 'AuditEvent',
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        occurredAt: now.toISOString(),
        correlationId: ctx.correlation_id,
        actor: ctx.actor,
        data: { audit_id: randomUUID() },
      });
      await insertOutbox(tx, env, TOPIC_AUDIT);
    });
    expect(store.released).toBeGreaterThan(0);
    expect(store.outboxPlatform.length).toBe(1);
  });
});
