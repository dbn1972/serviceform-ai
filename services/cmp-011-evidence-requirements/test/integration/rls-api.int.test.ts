import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { samplePolicy } from '../fixtures/policy.js';
import {
  ACTOR,
  asTenant,
  BINDING_ID,
  bearer,
  buildApp,
  closeHarness,
  installTenant,
  setupHarness,
  SUBJECT,
  T1,
  T2,
  type Harness,
} from './helpers.js';

let h: Harness;
let leakCount = 0;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

type Built = Awaited<ReturnType<typeof buildApp>>;

async function publish(b: Built, token: string, definition: unknown = samplePolicy()) {
  const created = await b.app.inject({
    method: 'POST',
    url: '/v1/evidence-policies',
    headers: bearer(token, { 'idempotency-key': `c-${randomUUID()}` }),
    payload: { policy_key: 'generic.policy', definition },
  });
  expect(created.statusCode).toBe(201);
  const published = await b.app.inject({
    method: 'POST',
    url: `/v1/evidence-policies/${created.json().policy_id}/publish`,
    headers: bearer(token, { 'idempotency-key': `p-${randomUUID()}` }),
  });
  expect(published.statusCode).toBe(200);
  return published.json() as { policy_id: string; version_ref: string; content_hash: string };
}

const body = {
  binding_id: BINDING_ID,
  facts: { 'applicant.category': 'P', 'applicant.age': 30 },
  rule_outcomes: { needs_extra: false },
};

describe('CMP-011 on PostgreSQL: publish, pin, resolve, isolate', () => {
  it('requires checker approval to publish', async () => {
    const b = await buildApp(h, { denyApproval: true });
    installTenant('t1', T1);
    const created = await b.app.inject({
      method: 'POST',
      url: '/v1/evidence-policies',
      headers: bearer('t1', { 'idempotency-key': 'deny-1' }),
      payload: { policy_key: 'generic.denied', definition: samplePolicy() },
    });
    const res = await b.app.inject({
      method: 'POST',
      url: `/v1/evidence-policies/${created.json().policy_id}/publish`,
      headers: bearer('t1', { 'idempotency-key': 'deny-2' }),
    });
    expect(res.statusCode).toBe(400);
    await b.app.close();
  });

  it('resolves from the pinned published version; published rows and outcomes are immutable', async () => {
    const b = await buildApp(h);
    installTenant('t1', T1);
    const pub = await publish(b, 't1');
    expect(pub.version_ref).toBe('generic.policy@1');
    b.pins.set(T1, BINDING_ID, {
      version_ref: pub.version_ref,
      content_hash: pub.content_hash,
      binding_status: 'PUBLISHED',
    });

    const res = await b.app.inject({
      method: 'POST',
      url: '/v1/evidence-requirements/calculate',
      headers: bearer('t1', { 'idempotency-key': 'calc-1' }),
      payload: { ...body, application_ref: 'APP-INT-1' },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.evidence_policy_version.content_hash).toBe(pub.content_hash);
    expect(out.checklist.requirements).toHaveLength(3);

    const replay = await b.app.inject({
      method: 'POST',
      url: '/v1/evidence-requirements/calculate',
      headers: bearer('t1', { 'idempotency-key': 'calc-1' }),
      payload: { ...body, application_ref: 'APP-INT-1' },
    });
    expect(replay.json().resolution_id).toBe(out.resolution_id);
    const rows = await asTenant(h.rt, T1, ACTOR, (c) =>
      c.query('SELECT 1 FROM sf_evidence.evidence_resolution WHERE binding_id = $1', [BINDING_ID]),
    );
    expect(rows.rowCount).toBe(1);

    const patch = await b.app.inject({
      method: 'PATCH',
      url: `/v1/evidence-policies/${pub.policy_id}`,
      headers: bearer('t1', { 'idempotency-key': 'mut-1' }),
      payload: { definition: samplePolicy() },
    });
    expect(patch.statusCode).toBe(400);
    await expect(
      asTenant(h.rt, T1, ACTOR, (c) =>
        c.query(`UPDATE sf_evidence.evidence_policy SET content_hash = $2 WHERE policy_id = $1`, [
          pub.policy_id,
          `sha256:${'0'.repeat(64)}`,
        ]),
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(
      asTenant(h.admin, T1, ACTOR, (c) =>
        c.query(
          `UPDATE sf_evidence.evidence_resolution SET simulated = true WHERE resolution_id = $1`,
          [out.resolution_id],
        ),
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
    await b.app.close();
  });

  it('a second published version does not alter what the first pin resolves', async () => {
    const b = await buildApp(h);
    installTenant('t1', T1);
    const v1Rows = await asTenant(h.rt, T1, ACTOR, (c) =>
      c.query<{ version_ref: string; content_hash: string }>(
        `SELECT version_ref, content_hash FROM sf_evidence.evidence_policy WHERE version_ref = 'generic.policy@1'`,
      ),
    );
    const v1 = v1Rows.rows[0] as { version_ref: string; content_hash: string };
    const def2 = samplePolicy();
    (def2.requirements[1] as { alternative_sets: unknown[] }).alternative_sets = [
      { code: 'SET_ONLY_Z', evidence_type_codes: ['PLACE_DOC_Z'] },
    ];
    const v2 = await publish(b, 't1', def2);
    expect(v2.version_ref).toBe('generic.policy@2');
    expect(v2.content_hash).not.toBe(v1.content_hash);
    b.pins.set(T1, BINDING_ID, { ...v1, binding_status: 'SUPERSEDED' });
    const res = await b.app.inject({
      method: 'POST',
      url: '/v1/evidence-requirements/calculate',
      headers: bearer('t1', { 'idempotency-key': 'calc-v1-after-v2' }),
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().evidence_policy_version.version_ref).toBe('generic.policy@1');
    await b.app.close();
  });

  it('uses DigiLocker only through the SIMULATED adapter and persists the simulated flag', async () => {
    const b = await buildApp(h, { tenantForDl: T1 });
    installTenant('t1', T1);
    const rows = await asTenant(h.rt, T1, ACTOR, (c) =>
      c.query<{ version_ref: string; content_hash: string }>(
        `SELECT version_ref, content_hash FROM sf_evidence.evidence_policy WHERE version_ref = 'generic.policy@1'`,
      ),
    );
    b.pins.set(T1, BINDING_ID, {
      ...(rows.rows[0] as { version_ref: string; content_hash: string }),
      binding_status: 'PUBLISHED',
    });
    const res = await b.app.inject({
      method: 'POST',
      url: '/v1/evidence-requirements/calculate',
      headers: bearer('t1', { 'idempotency-key': 'dl-1' }),
      payload: {
        ...body,
        subject_id: SUBJECT,
        digilocker: {
          purpose_code: 'EVIDENCE_LOOKUP',
          scenario: 'all_available',
          test_run_id: 'int-run-1',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().simulated).toBe(true);
    expect(res.json().digilocker.simulation.simulation).toBe(true);
    expect(res.json().checklist.complete).toBe(true);
    const stored = await asTenant(h.rt, T1, ACTOR, (c) =>
      c.query<{ simulated: boolean }>(
        'SELECT simulated FROM sf_evidence.evidence_resolution WHERE resolution_id = $1',
        [res.json().resolution_id],
      ),
    );
    expect(stored.rows[0]?.simulated).toBe(true);
    await b.app.close();
  });

  it('tenant-negative: T2 cannot read, resolve against or write T1 rows; CROSS_TENANT_LEAKAGE=0', async () => {
    const b = await buildApp(h);
    installTenant('t1', T1);
    installTenant('t2', T2);
    const t1Policy = await asTenant(h.rt, T1, ACTOR, (c) =>
      c.query<{ policy_id: string; version_ref: string; content_hash: string }>(
        `SELECT policy_id, version_ref, content_hash FROM sf_evidence.evidence_policy WHERE version_ref = 'generic.policy@1'`,
      ),
    );
    const t1 = t1Policy.rows[0] as { policy_id: string; version_ref: string; content_hash: string };
    const t1Resolution = await asTenant(h.rt, T1, ACTOR, (c) =>
      c.query<{ resolution_id: string }>(
        'SELECT resolution_id FROM sf_evidence.evidence_resolution LIMIT 1',
      ),
    );
    const resolutionId = t1Resolution.rows[0]?.resolution_id as string;

    // Same binding id and version_ref string under tenant T2 resolve only T2's own published content.
    const t2Def = samplePolicy();
    t2Def.requirements = t2Def.requirements.slice(0, 1);
    const t2 = await publish(b, 't2', t2Def);
    expect(t2.version_ref).toBe('generic.policy@1');
    expect(t2.content_hash).not.toBe(t1.content_hash);
    b.pins.set(T2, BINDING_ID, {
      version_ref: t2.version_ref,
      content_hash: t2.content_hash,
      binding_status: 'PUBLISHED',
    });
    const own = await b.app.inject({
      method: 'POST',
      url: '/v1/evidence-requirements/calculate',
      headers: bearer('t2', { 'idempotency-key': 't2-calc' }),
      payload: body,
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().checklist.requirements).toHaveLength(1);

    // T1's content hash pinned under T2's tenant must not resolve T1's row.
    b.pins.set(T2, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', {
      version_ref: t1.version_ref,
      content_hash: t1.content_hash,
      binding_status: 'PUBLISHED',
    });
    const mismatch = await b.app.inject({
      method: 'POST',
      url: '/v1/evidence-requirements/calculate',
      headers: bearer('t2', { 'idempotency-key': 't2-mismatch' }),
      payload: { ...body, binding_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().details[0].code).toBe('PIN_HASH_MISMATCH');

    const crossPolicy = await b.app.inject({
      method: 'GET',
      url: `/v1/evidence-policies/${t1.policy_id}`,
      headers: bearer('t2'),
    });
    const crossResolution = await b.app.inject({
      method: 'GET',
      url: `/v1/evidence-resolutions/${resolutionId}`,
      headers: bearer('t2'),
    });
    const crossBinding = await b.app.inject({
      method: 'POST',
      url: '/v1/evidence-requirements/calculate',
      headers: bearer('t2', { 'idempotency-key': 't2-unpinned' }),
      payload: { ...body, binding_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
    });
    for (const r of [crossPolicy, crossResolution, crossBinding]) {
      expect(r.statusCode).toBe(404);
      if (r.statusCode === 200) leakCount += 1;
      expect(r.body).not.toContain(t1.content_hash);
    }

    // RLS directly, as the runtime role.
    const scans = {
      evidence_policy: 'SELECT tenant_id FROM sf_evidence.evidence_policy',
      evidence_resolution: 'SELECT tenant_id FROM sf_evidence.evidence_resolution',
      idempotency_record: 'SELECT tenant_id FROM sf_evidence.idempotency_record',
    };
    for (const [table, scan] of Object.entries(scans)) {
      const seen = await asTenant(h.rt, T2, ACTOR, (c) => c.query<{ tenant_id: string }>(scan));
      const foreign = seen.rows.filter((r) => r.tenant_id !== T2);
      leakCount += foreign.length;
      expect(foreign, table).toHaveLength(0);
    }
    await expect(
      asTenant(h.rt, T2, ACTOR, (c) => c.query('SELECT 1 FROM sf_evidence.outbox_event')),
    ).rejects.toThrow();
    const noTenant = await asTenant(h.rt, null, ACTOR, (c) =>
      c.query('SELECT 1 FROM sf_evidence.evidence_policy'),
    );
    expect(noTenant.rowCount).toBe(0);
    await expect(
      asTenant(h.rt, T2, ACTOR, (c) =>
        c.query(
          `INSERT INTO sf_evidence.evidence_policy (policy_id, tenant_id, cell_id, policy_key, status, definition, content_hash, created_by)
           VALUES ($1,$2,'cell-01','forged.key','DRAFT','{}'::jsonb,$3,$4)`,
          [randomUUID(), T1, `sha256:${'cd'.repeat(32)}`, ACTOR],
        ),
      ),
    ).rejects.toThrow();
    await b.app.close();
    expect(leakCount).toBe(0);
    process.env['CROSS_TENANT_LEAKAGE'] = String(leakCount);
  });

  it('writes outbox and audit events in the same transaction, scoped to the tenant', async () => {
    const rows = await h.admin.query<{ event_type: string; tenant_id: string }>(
      'SELECT event_type, tenant_id FROM sf_evidence.outbox_event WHERE tenant_id = $1',
      [T1],
    );
    const types = new Set(rows.rows.map((r) => r.event_type));
    for (const t of [
      'EvidencePolicyCreated',
      'EvidencePolicyPublished',
      'EvidenceRequirementsResolved',
      'AuditEventSubmitted',
    ]) {
      expect(types.has(t), t).toBe(true);
    }
    expect(rows.rows.every((r) => r.tenant_id === T1)).toBe(true);
    const t2 = await h.admin.query('SELECT 1 FROM sf_evidence.outbox_event WHERE tenant_id = $1', [
      T2,
    ]);
    expect(t2.rowCount).toBeGreaterThan(0);
  });
});
