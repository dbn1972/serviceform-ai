import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { synthetic } from '../doubles/synthetic.js';
import {
  asTenant,
  buildApp,
  closeHarness,
  installActor,
  OFFICER,
  OTHER_OFFICER,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';

let h: Harness;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  h = await setupHarness();
  app = await buildApp(h);
  installActor('t1-token', T1, OFFICER);
  installActor('t2-token', T2, OTHER_OFFICER);
});
afterAll(async () => {
  await app.app.close();
  await closeHarness(h);
});

let n = 0;
async function call(token: string, method: 'GET' | 'POST', url: string, body?: unknown) {
  n += 1;
  const res = await app.app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${token}`,
      ...(method === 'POST' ? { 'idempotency-key': `int-${n}` } : {}),
    },
    ...(body === undefined ? {} : { payload: body as object }),
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

const MODEL = {
  provider_id: 'sim-primary',
  model_id: 'sim-model',
  model_version: '2026-10-01',
  operations: ['INVOKE', 'EMBED'],
  max_data_classification: 'PERSONAL',
  max_input_chars: 5000,
  max_output_tokens: 256,
  daily_token_budget: 100000,
};
const INVOKE = {
  policy_id: 'draft-reply',
  policy_version: 1,
  purpose: 'officer drafting assistance',
  data_classification: 'INTERNAL',
  variables: { subject: 'office opening hours' },
};

describe('CMP-039 against PostgreSQL as the non-owner runtime role', () => {
  let modelId = '';

  it('registers a pinned model and an immutable policy, then serves a governed advisory call', async () => {
    const m = await call('t1-token', 'POST', '/v1/ai/admin/models', MODEL);
    expect(m.status).toBe(201);
    modelId = m.body['model_entry_id'] as string;
    const p = await call('t1-token', 'POST', '/v1/ai/admin/policies', {
      policy_id: 'draft-reply',
      policy_version: 1,
      task_kind: 'DRAFT',
      template_body: 'Draft a polite reply about: {{subject}}',
      allowed_tools: [
        { tool_id: 'lookup_faq', version: '1', scopes: ['faq:read'], effect: 'READ_ONLY' },
      ],
      model_entry_ids: [modelId],
      max_data_classification: 'PERSONAL',
      max_output_tokens: 128,
      latency_budget_ms: 500,
      fallback_behavior: 'NON_AI_PATH',
      evaluation_ref: {
        dataset_id: 'eval-set',
        dataset_version: '1',
        threshold: 0.9,
        result: 'PASSED',
      },
    });
    expect(p.status).toBe(201);

    const dirty = [synthetic.email(), synthetic.nationalId(), synthetic.bearer()].join(' ');
    const r = await call('t1-token', 'POST', '/v1/ai/invoke', {
      ...INVOKE,
      variables: { subject: dirty },
    });
    expect(r.status).toBe(200);
    expect(r.body['advisory_only']).toBe(true);
    expect(r.body['statutory_decision']).toBe(false);

    const rows = await h.admin.query(
      `SELECT * FROM sf_ai_gateway.ai_request_metadata WHERE tenant_id = $1`,
      [T1],
    );
    expect(rows.rowCount).toBe(1);
    const row = rows.rows[0] as Record<string, unknown>;
    expect(row['outcome']).toBe('COMPLETED');
    expect(row['simulated']).toBe(true);
    expect(row['advisory_only']).toBe(true);
    expect(row['statutory_decision']).toBe(false);
    const dump =
      JSON.stringify(
        (await h.admin.query(`SELECT to_jsonb(t) AS j FROM sf_ai_gateway.ai_request_metadata t`))
          .rows,
      ) +
      JSON.stringify(
        (await h.admin.query(`SELECT envelope FROM sf_ai_gateway.outbox_event`)).rows,
      ) +
      JSON.stringify(
        (await h.admin.query(`SELECT response_body FROM sf_ai_gateway.idempotency_record`)).rows,
      );
    for (const v of [synthetic.email(), synthetic.nationalId(), synthetic.bearer()]) {
      expect(dump).not.toContain(v);
    }
    const events = await h.admin.query<{ event_type: string }>(
      `SELECT event_type FROM sf_ai_gateway.outbox_event WHERE tenant_id = $1`,
      [T1],
    );
    expect(events.rows.map((e) => e.event_type)).toEqual(
      expect.arrayContaining(['AIRequestCompleted', 'AuditEventSubmitted']),
    );
  });

  it('CROSS_TENANT_LEAKAGE=0: tenant B cannot read, use or enumerate tenant A configuration or audit', async () => {
    let leaks = 0;
    const use = await call('t2-token', 'POST', '/v1/ai/invoke', INVOKE);
    if (use.status === 200) leaks += 1;
    expect(use.status).toBe(404);
    const caps = await call('t2-token', 'GET', '/v1/ai/models/capabilities');
    leaks += (caps.body['models'] as unknown[]).length;
    const revoke = await call('t2-token', 'POST', `/v1/ai/admin/models/${modelId}/revoke`, {
      reason: 'x',
    });
    if (revoke.status === 200) leaks += 1;
    expect(revoke.status).toBe(404);

    const foreignRows = [
      'SELECT 1 FROM sf_ai_gateway.model_registry WHERE tenant_id <> $1',
      'SELECT 1 FROM sf_ai_gateway.ai_policy WHERE tenant_id <> $1',
      'SELECT 1 FROM sf_ai_gateway.ai_request_metadata WHERE tenant_id <> $1',
      'SELECT 1 FROM sf_ai_gateway.idempotency_record WHERE tenant_id <> $1',
    ];
    for (const sql of foreignRows) {
      const seen = await asTenant(h.rt, T2, OTHER_OFFICER, (c) => c.query(sql, [T2]));
      leaks += seen.rowCount ?? 0;
    }
    const noTenant = await asTenant(h.rt, null, OTHER_OFFICER, (c) =>
      c.query('SELECT 1 FROM sf_ai_gateway.ai_request_metadata'),
    );
    leaks += noTenant.rowCount ?? 0;
    const ownerView = await asTenant(h.rt, T1, OFFICER, (c) =>
      c.query('SELECT 1 FROM sf_ai_gateway.ai_request_metadata'),
    );
    expect(ownerView.rowCount).toBeGreaterThan(0);
    expect(leaks).toBe(0);
    console.warn(`CROSS_TENANT_LEAKAGE=${leaks}`);

    await expect(
      asTenant(h.rt, T2, OTHER_OFFICER, async (c) => {
        await c.query(
          `INSERT INTO sf_ai_gateway.model_registry (
             model_entry_id, tenant_id, cell_id, provider_id, model_id, model_version, operations,
             max_data_classification, max_input_chars, max_output_tokens, daily_token_budget, status, registered_by
           ) VALUES ($1,$2,'cell-01','sim-primary','m9','v9',ARRAY['INVOKE'],'INTERNAL',100,10,1000,'ACTIVE',$3)`,
          [randomUUID(), T1, OTHER_OFFICER],
        );
      }),
    ).rejects.toThrow();
  });

  it('denies unapproved model and revoked model against the real registry', async () => {
    const pinned = await call('t1-token', 'POST', '/v1/ai/invoke', {
      ...INVOKE,
      model: { provider_id: 'sim-primary', model_id: 'sim-model', model_version: '2026-09-30' },
    });
    expect(pinned.status).toBe(403);
    const revoked = await call('t1-token', 'POST', `/v1/ai/admin/models/${modelId}/revoke`, {
      reason: 'rotation',
    });
    expect(revoked.status).toBe(200);
    const after = await call('t1-token', 'POST', '/v1/ai/invoke', INVOKE);
    expect(after.status).toBe(403);
    const blocked = await h.admin.query(
      `SELECT count(*)::int AS n FROM sf_ai_gateway.ai_request_metadata WHERE outcome = 'BLOCKED' AND tenant_id = $1`,
      [T1],
    );
    expect((blocked.rows[0] as { n: number }).n).toBe(2);
  });

  it('database constraints reject decision task kinds, floating pins, mutation of published rows', async () => {
    const admin = await h.admin.connect();
    try {
      await expect(
        admin.query(
          `INSERT INTO sf_ai_gateway.ai_policy (
             tenant_id, cell_id, policy_id, policy_version, task_kind, operation, template_body, template_hash,
             variable_names, allowed_tools, model_entry_ids, max_data_classification, max_output_tokens,
             latency_budget_ms, fallback_behavior, evaluation_ref, status, registered_by
           ) VALUES ($1,'cell-01','decide-all',1,'ELIGIBILITY_DECISION','INVOKE','x',$2,'{}','[]',ARRAY[$3::uuid],
             'INTERNAL',10,500,'DENY','{"dataset_id":"d","dataset_version":"1","threshold":0.9,"result":"PASSED"}','ACTIVE',$4)`,
          [T1, `sha256:${'a'.repeat(64)}`, modelId, OFFICER],
        ),
      ).rejects.toThrow();
      await expect(
        admin.query(
          `INSERT INTO sf_ai_gateway.model_registry (
             model_entry_id, tenant_id, cell_id, provider_id, model_id, model_version, operations,
             max_data_classification, max_input_chars, max_output_tokens, daily_token_budget, status, registered_by
           ) VALUES ($1,$2,'cell-01','sim-primary','m2','latest',ARRAY['INVOKE'],'INTERNAL',100,10,1000,'ACTIVE',$3)`,
          [randomUUID(), T1, OFFICER],
        ),
      ).rejects.toThrow();
      await expect(
        admin.query(
          `UPDATE sf_ai_gateway.ai_policy SET template_body = 'changed' WHERE tenant_id = $1`,
          [T1],
        ),
      ).rejects.toThrow(/immutable/);
      await expect(
        admin.query(`DELETE FROM sf_ai_gateway.ai_policy WHERE tenant_id = $1`, [T1]),
      ).rejects.toThrow();
      await expect(
        admin.query(`UPDATE sf_ai_gateway.ai_request_metadata SET purpose = 'x'`),
      ).rejects.toThrow(/append-only/);
      await expect(
        admin.query(
          `UPDATE sf_ai_gateway.model_registry SET status = 'ACTIVE' WHERE status = 'REVOKED'`,
        ),
      ).rejects.toThrow(/immutable/);
      await expect(
        admin.query(`UPDATE sf_ai_gateway.ai_request_metadata SET statutory_decision = true`),
      ).rejects.toThrow();
    } finally {
      admin.release();
    }
  });
});
