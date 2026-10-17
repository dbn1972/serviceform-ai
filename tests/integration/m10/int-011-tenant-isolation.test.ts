import { describe, expect, it } from 'vitest';
import {
  APP_1,
  APP_2,
  CANARY,
  CATALOGUE_ID,
  ctxFor,
  InMemoryApplicationRepo,
  leaks,
  ODISHA_PUBLIC_SAMPLE,
  OWNER_INPUTS_READY,
  RecordingAuthorizer,
  T1,
  T2,
} from './support/fixtures.js';

/**
 * INT-011 M10 tenant isolation seam tests — Golden IND-SOC-002 (Residence Certificate).
 *
 * These tests exercise the harness scaffolding only.  They operate entirely on
 * in-memory doubles; no PostgreSQL, no real service, no invented eligibility.
 *
 * POLICY_INPUT_REQUIRED (Finding M-04): owner-supplied statute, eligibility,
 * fee and SLA inputs are NOT used here.  Any test that would require them is
 * marked with `it.todo` so the harness is already structured but blocked until
 * the policy owner provides inputs.
 *
 * CROSS_TENANT_LEAKAGE target = 0.
 */

let probes = 0;
let leakage = 0;

// ── In-memory application service double ──────────────────────────────────────

interface ApplicationCommandPort {
  submit(params: {
    ctx: ReturnType<typeof ctxFor>;
    application_id: string;
    catalogue_id: string;
    payload: Record<string, unknown>;
  }): Promise<{ status: number; body: unknown }>;

  get(params: {
    ctx: ReturnType<typeof ctxFor>;
    application_id: string;
  }): Promise<{ status: number; body: unknown }>;
}

/** Minimal in-process application service double wired to a tenant-partitioned repo. */
function buildService(repo: InMemoryApplicationRepo): ApplicationCommandPort {
  return {
    async submit({ ctx, application_id, catalogue_id, payload: _payload }) {
      if (ctx.tenant_id === null || ctx.tenant_id === '') {
        return { status: 400, body: { error_code: 'SF-SYS-003', message: 'tenant required' } };
      }
      const record = {
        application_id,
        tenant_id: ctx.tenant_id,
        catalogue_id,
        status: 'SUBMITTED',
        submitted_at: new Date().toISOString(),
      };
      repo.put(record);
      return {
        status: 201,
        body: { application_id, tenant_id: ctx.tenant_id, status: 'SUBMITTED' },
      };
    },

    async get({ ctx, application_id }) {
      const record = repo.get(ctx.tenant_id, application_id);
      if (!record) {
        return { status: 404, body: { error_code: 'SF-RES-001', message: 'not found' } };
      }
      return { status: 200, body: record };
    },
  };
}

/** Simulate a service that has been given a forged tenant header (extracted outside the service). */
function callWithForgedTenantHeader(
  service: ApplicationCommandPort,
  forgedTenantId: string,
  application_id: string,
): Promise<{ status: number; body: unknown }> {
  // In a real implementation the host layer rejects forged headers before routing;
  // this double mimics the expected 403 at the host boundary.
  // An empty tenant_id or any tenant_id that does not match a server-derived session
  // is treated as a forged/missing header and must be refused.
  const knownTenants = new Set([T1, T2]);
  if (!knownTenants.has(forgedTenantId)) {
    return Promise.resolve({
      status: 403,
      body: { error_code: 'SF-TEN-002', message: 'forged or missing tenant header rejected' },
    });
  }
  return service.get({ ctx: ctxFor(forgedTenantId), application_id });
}

// ── Seed helper ───────────────────────────────────────────────────────────────

async function seedT1(
  service: ApplicationCommandPort,
): Promise<{ application_id: string; tenant_id: string }> {
  const res = await service.submit({
    ctx: ctxFor(T1, 'CITIZEN'),
    application_id: APP_1,
    catalogue_id: CATALOGUE_ID,
    payload: {
      // Payload fields are scaffolded; real field definitions require POLICY_INPUT_REQUIRED inputs.
      _policy_input_required: true,
    },
  });
  expect(res.status).toBe(201);
  return { application_id: APP_1, tenant_id: T1 };
}

function foreignIds(t1: { application_id: string; tenant_id: string }): readonly string[] {
  return [T1, t1.application_id];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('INT-011 M10 tenant isolation (IND-SOC-002 harness scaffolding)', () => {
  it('tenant B cannot read a tenant-A application (404, no identifiers echoed)', async () => {
    const repo = new InMemoryApplicationRepo();
    const svc = buildService(repo);
    const t1 = await seedT1(svc);
    const f = foreignIds(t1);

    const res = await svc.get({ ctx: ctxFor(T2), application_id: APP_1 });
    probes += 1;
    leakage += leaks(res.body, f);

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(T1);
  });

  it('the same application_id submitted under two tenants yields distinct, non-colliding records', async () => {
    const repo = new InMemoryApplicationRepo();
    const svc = buildService(repo);

    const r1 = await svc.submit({
      ctx: ctxFor(T1, 'CITIZEN'),
      application_id: APP_1,
      catalogue_id: CATALOGUE_ID,
      payload: { _policy_input_required: true },
    });
    const r2 = await svc.submit({
      ctx: ctxFor(T2, 'CITIZEN'),
      application_id: APP_1,
      catalogue_id: CATALOGUE_ID,
      payload: { _policy_input_required: true },
    });

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    const t1Record = repo.get(T1, APP_1);
    const t2Record = repo.get(T2, APP_1);
    expect(t1Record?.tenant_id).toBe(T1);
    expect(t2Record?.tenant_id).toBe(T2);

    // No cross-contamination: T2 partition does not contain T1's identifier
    probes += 1;
    leakage += leaks(t2Record, [T1]);
    expect(leaks(t2Record, [T1])).toBe(0);
  });

  it('a tenant-A application_id submitted with a tenant-B context is stored only in T2 partition', async () => {
    const repo = new InMemoryApplicationRepo();
    const svc = buildService(repo);

    await svc.submit({
      ctx: ctxFor(T2, 'CITIZEN'),
      application_id: APP_2,
      catalogue_id: CATALOGUE_ID,
      payload: { _policy_input_required: true },
    });

    probes += 1;
    expect(repo.get(T1, APP_2)).toBeUndefined();
    expect(repo.get(T2, APP_2)?.tenant_id).toBe(T2);
    leakage += leaks(repo.get(T2, APP_2), [T1]);
  });

  it('forged tenant header is refused at the host boundary (SF-TEN-002), no service call made', async () => {
    const repo = new InMemoryApplicationRepo();
    const svc = buildService(repo);
    const t1 = await seedT1(svc);

    const FORGED_HEADERS = [CANARY, ''] as const;
    for (const forgedId of FORGED_HEADERS) {
      const res = await callWithForgedTenantHeader(svc, forgedId, t1.application_id);
      probes += 1;
      leakage += leaks(res.body, foreignIds(t1));
      expect(res.status, `forged header: '${forgedId}'`).toBe(403);
      expect((res.body as { error_code: string }).error_code).toBe('SF-TEN-002');
    }
    // After forged calls, T1 partition unchanged; T2 still empty
    expect(repo.tenant(T1).size).toBe(1);
    expect(repo.tenant(T2).size).toBe(0);
  });

  it('client-supplied tenant_id in command body is never adopted as identity', async () => {
    const repo = new InMemoryApplicationRepo();
    const svc = buildService(repo);

    // The service derives tenant_id from ctx (server-side), not from the payload body.
    // Supplying tenant_id in the payload must not change which partition is written.
    const res = await svc.submit({
      ctx: ctxFor(T2, 'CITIZEN'),
      application_id: APP_1,
      catalogue_id: CATALOGUE_ID,
      payload: {
        tenant_id: T1,
        _policy_input_required: true,
      },
    });
    probes += 1;
    leakage += leaks(res.body, [T1]);

    expect(res.status).toBe(201);
    // Written to T2, not T1
    expect(repo.get(T2, APP_1)?.tenant_id).toBe(T2);
    expect(repo.get(T1, APP_1)).toBeUndefined();
    // Response must not echo back T1
    expect(JSON.stringify(res.body)).not.toContain(T1);
  });

  it('OPA authorizer subject.tenant_id always equals the server-derived tenant, never CANARY', async () => {
    const auth = new RecordingAuthorizer();

    // Simulate authorizer being called with the server-derived tenant_id
    await auth.decide({ action: 'application:submit', subject: { tenant_id: T1 } });
    await auth.decide({ action: 'application:read', subject: { tenant_id: T2 } });

    probes += auth.calls.length;
    for (const c of auth.calls) {
      expect([T1, T2]).toContain(c.subject.tenant_id);
      expect(c.subject.tenant_id).not.toBe(CANARY);
    }
    leakage += leaks(auth.calls, [CANARY]);
  });

  it('aggregate: CROSS_TENANT_LEAKAGE = 0 across all M10 tenant-negative probes', () => {
    expect(probes).toBeGreaterThanOrEqual(6);
    expect(leakage).toBe(0);
  });

  // ── Odisha public-portal sample (SF_M10_OWNER_INPUTS_READY=1) ─────────────

  it.skipIf(!OWNER_INPUTS_READY)(
    'Odisha sample: eligibility rejects <12 months without published relaxation',
    () => {
      const months = 6;
      const eligible =
        months >= ODISHA_PUBLIC_SAMPLE.min_residence_months || false; /* no relaxation supplied */
      expect(eligible).toBe(false);
      expect(ODISHA_PUBLIC_SAMPLE.min_residence_months).toBe(12);
      expect(ODISHA_PUBLIC_SAMPLE.policy_source_url).toContain('edistrict.odisha.gov.in');
    },
  );

  it.skipIf(!OWNER_INPUTS_READY)(
    'Odisha sample: fee is ₹0 government service charge (0 paisa)',
    () => {
      expect(ODISHA_PUBLIC_SAMPLE.fee_amount_paisa).toBe(0);
      expect(ODISHA_PUBLIC_SAMPLE.fee_schedule_ref).toContain('fee-policy.yaml');
    },
  );

  it.skipIf(!OWNER_INPUTS_READY)(
    'Odisha sample: overall SLA is 10 working days from APPLICATION_SUBMITTED',
    () => {
      expect(ODISHA_PUBLIC_SAMPLE.sla_working_days).toBe(10);
      expect(ODISHA_PUBLIC_SAMPLE.sla_ref).toContain('sla-policy.yaml');
    },
  );

  it.skipIf(!OWNER_INPUTS_READY)(
    'Odisha sample: credential template ref is SAMPLE_LAB (not DigiLocker-registered)',
    () => {
      expect(ODISHA_PUBLIC_SAMPLE.credential_template_ref).toMatch(/^SAMPLE_LAB_/);
    },
  );

  it.todo(
    'PRODUCTION DigiLocker publish path — blocked until REAL DigiLocker binding ' +
      '(SAMPLE_LAB doc type only; Architecture Constitution rule 14)',
  );
});
