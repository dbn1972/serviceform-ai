import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validate } from '@serviceform/contracts';
import { buildApp } from '../../../apps/api/src/app.js';
import type { M09PluginMounts } from '../../../apps/api/src/composition/m09.js';
import {
  ADMIN_1,
  CANARY,
  CITIZEN_1,
  config,
  ContextState,
  ctxFor,
  DOC,
  idemHeaders,
  OFFICER_1,
  RecordingAuthorizer,
  silentLogger,
  T1,
} from './support/fixtures.js';
import { RecordingPool } from './support/pool-double.js';
import { TenantRecorder } from './support/mounts.js';
import { validateM09 } from './support/m09-schemas.js';

/**
 * High-level host seams for INT-016 (CMP-058), INT-017 (CMP-059), INT-018 (CMP-060) and
 * INT-019 (CMP-061). Owner domain logic is not re-tested here; these checks observe what crosses
 * the host boundary: tenant scoping, DB session context, PDP wiring and transaction boundaries.
 */
const OFFICER = ctxFor(T1, OFFICER_1, 'OFFICER');
const ADMIN = ctxFor(T1, ADMIN_1, 'PRIVILEGED_ADMIN');
const SUBJECT_APP = 'abababab-abab-4bab-8bab-abababababab';

/** FROZEN SF-CON-DB-SESSION-CONTEXT: the only transaction-local settings a repository may apply. */
function sessionContextViolations(pool: RecordingPool): string[] {
  const out: string[] = [];
  for (const tx of pool.txs) {
    const r = validate('db-session-context', tx.settings);
    if (!r.valid) out.push(JSON.stringify(Object.keys(tx.settings).sort()));
    if (!('app.tenant_id' in tx.settings)) out.push(`tx#${tx.id} missing app.tenant_id`);
  }
  return [...new Set(out)];
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function host(m09: M09PluginMounts): Promise<FastifyInstance> {
  app = await buildApp(config, { logger: silentLogger(), m09 });
  return app;
}

describe('INT-016 semantic registry host seam (CMP-058)', () => {
  it('element read: PDP sees server tenant; DB tx applies FROZEN SF-CON-DB-SESSION-CONTEXT', async () => {
    const pool = new RecordingPool();
    const authz = new RecordingAuthorizer();
    const a = await host({
      semantic: { options: { pool, authorizer: authz }, resolveContext: async () => OFFICER },
    });
    const res = await a.inject({ method: 'GET', url: '/v1/bindings' });
    expect(res.statusCode).toBe(200);
    expect(authz.calls.map((c) => c.subject.tenant_id)).toEqual([T1]);
    expect(pool.tenantsSeen()).toEqual([T1]);
    expect(sessionContextViolations(pool)).toEqual([]);
    expect(pool.openTransactions()).toBe(0);
  });

  it('PDP deny → SF-AUTH-002 with no data statement executed', async () => {
    const pool = new RecordingPool();
    const authz = new RecordingAuthorizer();
    authz.denyAll = true;
    const a = await host({
      semantic: { options: { pool, authorizer: authz }, resolveContext: async () => OFFICER },
    });
    const res = await a.inject({ method: 'GET', url: '/v1/bindings' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    expect(pool.dataStatements()).toEqual([]);
  });

  it('PDP unavailable → fail closed with the frozen error envelope and no data statement', async () => {
    const pool = new RecordingPool();
    const authz = new RecordingAuthorizer();
    authz.fail = true;
    const a = await host({
      semantic: { options: { pool, authorizer: authz }, resolveContext: async () => OFFICER },
    });
    const res = await a.inject({ method: 'GET', url: '/v1/elements' });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(validate('error-response', res.json()).valid).toBe(true);
    expect(pool.dataStatements()).toEqual([]);
  });

  it('tenant-bound bindings refuse a tenant-less context (SF-TEN-001)', async () => {
    const pool = new RecordingPool();
    const a = await host({
      semantic: {
        options: { pool, authorizer: new RecordingAuthorizer() },
        resolveContext: async () => ({ ...ADMIN, tenant_id: null }),
      },
    });
    const res = await a.inject({ method: 'GET', url: '/v1/bindings' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error_code: 'SF-TEN-001' });
    expect(pool.statements).toEqual([]);
  });

  it('element authoring requires PRIVILEGED_ADMIN; an officer is refused before any write', async () => {
    const pool = new RecordingPool();
    const a = await host({
      semantic: {
        options: { pool, authorizer: new RecordingAuthorizer() },
        resolveContext: async () => OFFICER,
      },
    });
    const res = await a.inject({
      method: 'POST',
      url: '/v1/elements',
      headers: idemHeaders('semantic-key-0001'),
      payload: { element_code: 'synthetic.element', privacy_classification: 'PUBLIC' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(pool.dataStatements().filter((s) => /^\s*INSERT/i.test(s.sql))).toEqual([]);
  });
});

describe('INT-017 migration workbench host seam (CMP-059)', () => {
  it('host mount without an authorizer fails closed (deny-all default)', async () => {
    const pool = new RecordingPool();
    const a = await host({
      migration: { options: { pool }, resolveContext: async () => OFFICER },
    });
    const res = await a.inject({ method: 'GET', url: `/v1/migrations/${DOC}/reconciliation` });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    expect(pool.dataStatements()).toEqual([]);
  });

  it('reconciliation read: PDP and DB tx use the server tenant only', async () => {
    const pool = new RecordingPool();
    const authz = new RecordingAuthorizer();
    const a = await host({
      migration: { options: { pool, authorizer: authz }, resolveContext: async () => OFFICER },
    });
    const res = await a.inject({ method: 'GET', url: `/v1/migrations/${DOC}/reconciliation` });
    expect(res.statusCode).toBeLessThan(500);
    expect(new Set(authz.calls.map((c) => c.subject.tenant_id))).toEqual(new Set([T1]));
    expect(pool.tenantsSeen()).toEqual([T1]);
    expect(pool.openTransactions()).toBe(0);
  });

  it.fails('[F-03 CMP-059] DB transaction applies FROZEN SF-CON-DB-SESSION-CONTEXT keys (app.tenant_id read by sf_platform.current_tenant_id())', async () => {
    const pool = new RecordingPool();
    const a = await host({
      migration: {
        options: { pool, authorizer: new RecordingAuthorizer() },
        resolveContext: async () => OFFICER,
      },
    });
    await a.inject({ method: 'GET', url: `/v1/migrations/${DOC}/reconciliation` });
    expect(pool.txs.length).toBeGreaterThan(0);
    expect(sessionContextViolations(pool), `keys applied: ${pool.settingKeys().join(',')}`).toEqual(
      [],
    );
  });

  it('body tenant_id on project creation is never adopted', async () => {
    const pool = new RecordingPool();
    const a = await host({
      migration: {
        options: { pool, authorizer: new RecordingAuthorizer() },
        resolveContext: async () => OFFICER,
      },
    });
    const res = await a.inject({
      method: 'POST',
      url: '/v1/migrations/projects',
      headers: idemHeaders('migration-key-0001'),
      payload: { display_name: 'synthetic', tenant_id: CANARY },
    });
    expect(res.body).not.toContain(CANARY);
    expect(pool.tenantsSeen()).not.toContain(CANARY);
    expect(pool.statements.flatMap((s) => s.params)).not.toContain(CANARY);
  });
});

describe('INT-018 risk / integrity signal to authorized review host seam (CMP-060)', () => {
  const rowsFor = (sql: string) =>
    /^\s*UPDATE/i.test(sql) ? { rows: [], rowCount: 1 } : { rows: [] as unknown[] };

  function riskBody(score: number, signals: Array<{ signal_code: string }> = []) {
    return {
      subject_application_id: SUBJECT_APP,
      idempotency_key: `risk-key-${score}`,
      raw_risk_score: score,
      model_or_rule_version: 'synthetic-rules-v1',
      signals: signals.map((s) => ({ ...s, provenance_ref: 'synthetic.provenance' })),
    };
  }

  it.fails('[F-07 CMP-060] advisory assessment: tenant from context only; response is non-authoritative and FROZEN-conformant', async () => {
    const pool = new RecordingPool(rowsFor);
    const recorder = new TenantRecorder();
    const a = await host({
      risk: {
        options: { pool, authz: recorder.riskAuthz() },
        resolveContext: async () => OFFICER,
      },
    });
    const res = await a.inject({
      method: 'POST',
      url: '/v1/risk/assessments',
      payload: riskBody(0.1, [{ signal_code: 'DOCUMENT_MISMATCH' }]),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      tenant_id: T1,
      authoritative_decision_by_this_component: false,
    });
    const v = validateM09('risk-assessment', body);
    expect(v.valid, JSON.stringify(v.errors)).toBe(true);
    expect(recorder.seen).toEqual([T1]);
    expect(pool.tenantsSeen()).toEqual([T1]);
  });

  it('statutory-outcome signal codes are refused (no automated adverse decision)', async () => {
    const pool = new RecordingPool(rowsFor);
    const recorder = new TenantRecorder();
    const a = await host({
      risk: { options: { pool, authz: recorder.riskAuthz() }, resolveContext: async () => OFFICER },
    });
    const res = await a.inject({
      method: 'POST',
      url: '/v1/risk/assessments',
      payload: riskBody(0.2, [{ signal_code: 'REJECT' }]),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(pool.dataStatements()).toEqual([]);
  });

  it.fails('[F-04 CMP-060] host mount without an authz port fails closed (no SIMULATED allow-all default)', async () => {
    const pool = new RecordingPool(rowsFor);
    const a = await host({
      risk: { options: { pool }, resolveContext: async () => OFFICER },
    });
    const res = await a.inject({
      method: 'POST',
      url: '/v1/risk/assessments',
      payload: riskBody(0.3),
    });
    expect(res.statusCode, 'risk assessment created with no authorization port bound').toBe(403);
    expect(pool.dataStatements()).toEqual([]);
  });

  it.fails('[F-06 CMP-060] HIGH/CRITICAL review routing (external port) is not called inside the authoritative DB tx', async () => {
    const pool = new RecordingPool(rowsFor);
    const recorder = new TenantRecorder();
    const routed: Array<{ openTx: number; tenant: string }> = [];
    const a = await host({
      risk: {
        options: {
          pool,
          authz: recorder.riskAuthz(),
          reviewRouting: {
            routeToReview: async (p: { tenant_id: string; assessment_id: string }) => {
              routed.push({ openTx: pool.openTransactions(), tenant: p.tenant_id });
              return { routing_ref: `review-${p.assessment_id}` };
            },
          },
        },
        resolveContext: async () => OFFICER,
      },
    });
    const res = await a.inject({
      method: 'POST',
      url: '/v1/risk/assessments',
      payload: riskBody(0.99),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ review_requested: true });
    expect(routed.map((r) => r.tenant)).toEqual([T1]);
    expect(
      routed.map((r) => r.openTx),
      'open DB transactions when routeToReview ran',
    ).toEqual([0]);
  });

  it.fails('[F-02 CMP-060] DB transaction applies FROZEN SF-CON-DB-SESSION-CONTEXT keys (RLS reads sf_platform.current_tenant_id())', async () => {
    const pool = new RecordingPool(rowsFor);
    const recorder = new TenantRecorder();
    const a = await host({
      risk: { options: { pool, authz: recorder.riskAuthz() }, resolveContext: async () => OFFICER },
    });
    await a.inject({ method: 'GET', url: `/v1/risk/assessments/${DOC}` });
    expect(pool.txs.length).toBeGreaterThan(0);
    expect(sessionContextViolations(pool), `keys applied: ${pool.settingKeys().join(',')}`).toEqual(
      [],
    );
  });

  it('body tenant_id on review disposition is refused', async () => {
    const pool = new RecordingPool(rowsFor);
    const recorder = new TenantRecorder();
    const a = await host({
      risk: { options: { pool, authz: recorder.riskAuthz() }, resolveContext: async () => OFFICER },
    });
    const res = await a.inject({
      method: 'POST',
      url: `/v1/risk/assessments/${DOC}/review`,
      payload: { disposition: 'CLEARED', tenant_id: CANARY },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain(CANARY);
    expect(pool.statements).toEqual([]);
  });
});

describe('INT-019 privacy rights centre host seam (CMP-061)', () => {
  async function privacyHost(state: ContextState) {
    const recorder = new TenantRecorder();
    const a = await host({
      privacy: { service: recorder.service('privacy'), resolveContext: state.resolve },
    });
    return { a, recorder };
  }

  it('citizen privacy reads reach the owner service with the server tenant only', async () => {
    const { a, recorder } = await privacyHost(new ContextState(ctxFor(T1, CITIZEN_1, 'CITIZEN')));
    for (const url of [
      '/v1/privacy/me',
      '/v1/privacy/me/consents',
      `/v1/privacy/requests/${DOC}`,
    ]) {
      expect((await a.inject({ method: 'GET', url })).statusCode, url).toBe(200);
    }
    expect(recorder.seen).toEqual([T1, T1, T1]);
  });

  it('submit without Idempotency-Key, with body tenant_id or with owner-only legal basis is refused before the service', async () => {
    const { a, recorder } = await privacyHost(new ContextState(ctxFor(T1, CITIZEN_1, 'CITIZEN')));
    const base = {
      request_type: 'ACCESS',
      submit_assurance: 'OTP',
      scope: [{ data_category_ref: 'synthetic.category' }],
    };
    const noKey = await a.inject({ method: 'POST', url: '/v1/privacy/requests', payload: base });
    expect(noKey.statusCode).toBe(400);
    const tenanted = await a.inject({
      method: 'POST',
      url: '/v1/privacy/requests',
      headers: idemHeaders('privacy-key-0001'),
      payload: { ...base, tenant_id: CANARY },
    });
    expect(tenanted.statusCode).toBeGreaterThanOrEqual(400);
    expect(tenanted.body).not.toContain(CANARY);
    const legal = await a.inject({
      method: 'POST',
      url: '/v1/privacy/requests',
      headers: idemHeaders('privacy-key-0002'),
      payload: { ...base, legal_basis_or_exception_ref: 'synthetic.ref' },
    });
    expect(legal.statusCode).toBe(400);
    expect(recorder.seen).toEqual([]);
  });

  it('owner-task outcome route is tenant-scoped from context; forged header denied before the service', async () => {
    const { a, recorder } = await privacyHost(new ContextState(OFFICER));
    const res = await a.inject({
      method: 'POST',
      url: `/v1/privacy/tasks/${DOC}/outcomes`,
      headers: { ...idemHeaders('privacy-key-0003'), 'x-tenant-id': CANARY },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    expect(recorder.seen).toEqual([]);
  });
});
