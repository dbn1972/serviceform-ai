import { describe, expect, it } from 'vitest';
import {
  APP_1,
  CANARY,
  conforms,
  ctxFor,
  finding,
  leaks,
  T1,
  T2,
  TYPE_REF,
} from './support/fixtures.js';
import { issue, issueActiveWithQr, publish, REG } from './support/flow.js';
import { buildStack, type Cmp, type Stack } from './support/wiring.js';

/**
 * INT-011 re-verification at the M07 component seams. A tenant-B principal probes every M07
 * read/command against tenant-A resources; any tenant-A identifier in a response counts as
 * leakage. CROSS_TENANT_LEAKAGE must be 0.
 */

let probes = 0;
let leakage = 0;

async function seedT1(s: Stack) {
  const a = await issueActiveWithQr(s, T1, APP_1);
  const pub = await publish(s, T1, a.credentialId);
  expect(pub.status).toBe(201);
  return { ...a, publishId: pub.body.publish_request_id as string };
}

function foreignIds(t1: Awaited<ReturnType<typeof seedT1>>): string[] {
  return [T1, t1.credentialId, t1.tokenId, t1.opaque, t1.publishId];
}

async function probe(
  s: Stack,
  foreign: readonly string[],
  cmp: Cmp,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) {
  const res = await s.call(cmp, method, path, body, {
    ctx: ctxFor(T2, method === 'POST' ? 'SYSTEM' : 'OFFICER'),
    ...(headers ? { headers } : {}),
  });
  probes += 1;
  leakage += leaks(res.body, foreign);
  return res;
}

describe('INT-011 M07 tenant isolation chain', () => {
  it('tenant B cannot read any tenant-A M07 resource (not found, no identifiers echoed)', async () => {
    const s = buildStack();
    const t1 = await seedT1(s);
    const f = foreignIds(t1);
    const reads: Array<[Cmp, string]> = [
      ['CMP-022', `/v1/credentials/${t1.credentialId}`],
      ['CMP-022', `/v1/credentials/${t1.credentialId}/signing-records`],
      ['CMP-024', `${REG}/${t1.credentialId}/status`],
      ['CMP-023', `/v1/qr/tokens/${t1.tokenId}`],
      ['CMP-012', `/v1/digilocker-publish/${t1.publishId}`],
    ];
    for (const [cmp, path] of reads) {
      const res = await probe(s, f, cmp, 'GET', path);
      expect(res.status, `${cmp} ${path}`).toBe(404);
      expect(conforms('error-response', res.body).errors).toBe('');
    }
    const list = await probe(s, f, 'CMP-022', 'GET', `/v1/applications/${APP_1}/credentials`);
    expect(list.status).toBe(200);
    expect(list.body.credentials).toEqual([]);
  });

  it('a tenant-A opaque QR token does not verify under a tenant-B context', async () => {
    const s = buildStack();
    const t1 = await seedT1(s);
    const res = await s.call('CMP-023', 'GET', `/v1/qr/verify/${t1.opaque}`, undefined, {
      ctx: ctxFor(T2, 'CITIZEN'),
    });
    probes += 1;
    leakage += leaks(res.body, foreignIds(t1));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('ACTIVE');
  });

  it('tenant B cannot transition, mint QR for, or record outcomes on tenant-A credentials', async () => {
    const s = buildStack();
    const t1 = await seedT1(s);
    const f = foreignIds(t1);
    const revoke = await probe(s, f, 'CMP-024', 'POST', `${REG}/${t1.credentialId}/revoke`, {
      expected_version: 2,
      reason_code_ref: 'reason:x',
    });
    expect(revoke.status).toBe(404);
    const mint = await probe(s, f, 'CMP-023', 'POST', '/v1/qr/tokens', {
      credential_id: t1.credentialId,
      credential_type_ref: TYPE_REF,
    });
    expect(mint.status).toBe(404);
    const outcome = await probe(
      s,
      f,
      'CMP-022',
      'POST',
      `/v1/credentials/${t1.credentialId}/downstream-outcomes`,
      {
        channel: 'NOTIFICATION',
        outcome: 'FAILED',
        outcome_ref: 'n:x',
        failure_code: 'SF-INT-001',
      },
    );
    expect(outcome.status).toBe(404);

    expect(s.repos.registry.tenant(T1).entries.get(t1.credentialId)?.current_status).toBe('ACTIVE');
    expect(s.repos.registry.tenant(T2).entries.size).toBe(0);
    expect(s.repos.qr.tenant(T2).tokens.size).toBe(0);
    expect(s.repos.credential.tenant(T1).outcomes.length).toBe(0);
  });

  it('the same application id in two tenants yields distinct, non-colliding credentials', async () => {
    const s = buildStack();
    const a = await issue(s, T1, APP_1, 'issue:same:1');
    const b = await issue(s, T2, APP_1, 'issue:same:1');
    expect(a.credentialId).not.toBe(b.credentialId);
    expect(b.credential['tenant_id']).toBe(T2);
    leakage += leaks(b.credential, [T1, a.credentialId]);
    probes += 1;
    expect(s.repos.registry.tenant(T2).entries.has(b.credentialId)).toBe(true);
    expect(s.repos.registry.tenant(T2).entries.has(a.credentialId)).toBe(false);
  });

  const FORGED_HEADERS: ReadonlyArray<Record<string, string>> = [
    { 'x-tenant-id': CANARY },
    { 'X-Tenant-ID': T1 },
    { 'x-sf-tenant': CANARY },
    { forwarded: `for=192.0.2.1;tenant=${CANARY}` },
  ];

  async function forgedHeaderRun(s: Stack, routes: Array<[Cmp, 'GET' | 'POST', string, unknown]>) {
    const sizes = () =>
      JSON.stringify([
        s.repos.credential.tenant(T1).credentials.size,
        s.repos.registry.tenant(T1).entries.size,
        s.repos.qr.tenant(T1).tokens.size,
        s.repos.digilocker.tenant(T1).publishRecords.size,
        s.repos.digilocker.tenant(T2).publishRecords.size,
      ]);
    const before = sizes();
    for (const [cmp, method, path, body] of routes) {
      for (const headers of FORGED_HEADERS) {
        const res = await probe(s, [CANARY], cmp, method, path, body, headers);
        expect(res.status, `${cmp} ${method} ${path} ${JSON.stringify(headers)}`).toBe(403);
        expect(res.body.error_code).toBe('SF-TEN-002');
        expect(conforms('error-response', res.body).errors).toBe('');
      }
    }
    expect(sizes()).toBe(before);
  }

  it('forged tenant headers are refused with SF-TEN-002 on every CMP-022/024/023 route before any write', async () => {
    const s = buildStack();
    const t1 = await seedT1(s);
    await forgedHeaderRun(s, [
      ['CMP-022', 'GET', `/v1/credentials/${t1.credentialId}`, undefined],
      ['CMP-022', 'GET', `/v1/applications/${APP_1}/credentials`, undefined],
      [
        'CMP-022',
        'POST',
        '/v1/credentials',
        { application_id: APP_1, issuance_key: 'issue:forged:9' },
      ],
      ['CMP-024', 'GET', `${REG}/${t1.credentialId}/status`, undefined],
      ['CMP-024', 'POST', REG, { credential_id: CANARY, issuer_ref: 'issuer:x' }],
      [
        'CMP-024',
        'POST',
        `${REG}/${t1.credentialId}/revoke`,
        { expected_version: 2, reason_code_ref: 'r:x' },
      ],
      ['CMP-023', 'GET', `/v1/qr/tokens/${t1.tokenId}`, undefined],
      ['CMP-023', 'GET', `/v1/qr/verify/${t1.opaque}`, undefined],
      [
        'CMP-023',
        'POST',
        '/v1/qr/tokens',
        { credential_id: t1.credentialId, credential_type_ref: TYPE_REF },
      ],
    ]);
  });

  finding(
    'FINDING M07-INT-F05: CMP-012 does not refuse forged tenant headers (x-tenant-id, x-sf-*, Forwarded tenant=) with SF-TEN-002 at the component boundary',
    async () => {
      const s = buildStack();
      const t1 = await seedT1(s);
      await forgedHeaderRun(s, [
        ['CMP-012', 'GET', `/v1/digilocker-publish/${t1.publishId}`, undefined],
        [
          'CMP-012',
          'POST',
          '/v1/digilocker-publish',
          {
            credential_id: t1.credentialId,
            consent_ref: 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
            purpose_code: 'CREDENTIAL_PUBLISH',
            document_type_ref: 'doctype:x',
            test_run_id: 'run',
          },
        ],
      ]);
    },
  );

  it('client-supplied tenant_id in a command body is refused and nothing is written', async () => {
    const s = buildStack();
    const t1 = await seedT1(s);
    const cases: Array<[Cmp, string, Record<string, unknown>]> = [
      [
        'CMP-022',
        '/v1/credentials',
        { application_id: APP_1, issuance_key: 'issue:tid:1', tenant_id: T1 },
      ],
      ['CMP-024', REG, { credential_id: CANARY, issuer_ref: 'issuer:x', tenant_id: T1 }],
      [
        'CMP-023',
        '/v1/qr/tokens',
        { credential_id: t1.credentialId, credential_type_ref: TYPE_REF, tenant_id: T1 },
      ],
    ];
    for (const [cmp, path, body] of cases) {
      const res = await probe(s, foreignIds(t1), cmp, 'POST', path, body);
      expect([400, 403], `${cmp} ${path}`).toContain(res.status);
      expect(res.body.error_code).toMatch(/^SF-(TEN-002|SYS-003)$/);
    }
    expect(s.repos.credential.tenant(T2).credentials.size).toBe(0);
    expect(s.repos.registry.tenant(T2).entries.size).toBe(0);
    expect(s.repos.qr.tenant(T2).tokens.size).toBe(0);
  });

  it('CMP-023 blocks a cross-tenant record returned by a misbehaving CMP-022/CMP-024 port (SF-TEN-002)', async () => {
    const s = buildStack();
    const t1 = await seedT1(s);
    const b = await issue(s, T2, APP_1, 'issue:b:1');

    const realCred = s.credentialRead.getCredential.bind(s.credentialRead);
    s.credentialRead.getCredential = (p) =>
      realCred({ ...p, tenantId: T1, credentialId: t1.credentialId });
    const viaCred = await s.call(
      'CMP-023',
      'POST',
      '/v1/qr/tokens',
      {
        credential_id: t1.credentialId,
        credential_type_ref: TYPE_REF,
      },
      { ctx: ctxFor(T2, 'SYSTEM') },
    );
    probes += 1;
    leakage += leaks(viaCred.body, foreignIds(t1));
    expect(viaCred.status).toBe(403);
    expect(viaCred.body.error_code).toBe('SF-TEN-002');
    s.credentialRead.getCredential = realCred;

    const realStatus = s.statusRead.getStatus.bind(s.statusRead);
    s.statusRead.getStatus = async (p) => {
      const rec = await realStatus({ tenantId: T1, credentialId: t1.credentialId });
      return rec ? { ...rec, credential_id: p.credentialId } : rec;
    };
    const viaReg = await s.call(
      'CMP-023',
      'POST',
      '/v1/qr/tokens',
      {
        credential_id: b.credentialId,
        credential_type_ref: TYPE_REF,
      },
      { ctx: ctxFor(T2, 'SYSTEM') },
    );
    probes += 1;
    leakage += leaks(viaReg.body, foreignIds(t1));
    expect(viaReg.status).toBe(403);
    expect(viaReg.body.error_code).toBe('SF-TEN-002');
    expect(s.repos.qr.tenant(T2).tokens.size).toBe(0);
  });

  it('CMP-012 refuses a connector binding owned by another tenant (SF-TEN-002)', async () => {
    const s = buildStack();
    const { credentialId } = await issue(s, T2, APP_1);
    s.bindings.byTenant.set(T2, s.bindings.simulated(T1));
    const res = await s.call(
      'CMP-012',
      'POST',
      '/v1/digilocker-publish',
      {
        credential_id: credentialId,
        consent_ref: 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
        purpose_code: 'CREDENTIAL_PUBLISH',
        document_type_ref: 'doctype:x',
        test_run_id: 'run',
      },
      { ctx: ctxFor(T2, 'SYSTEM') },
    );
    probes += 1;
    leakage += leaks(res.body, [T1]);
    expect(res.status).toBe(403);
    expect(res.body.error_code).toBe('SF-TEN-002');
    expect(s.digilockerApi.calls.length).toBe(0);
  });

  it('every authorisation request carries subject.tenant_id equal to the server-derived tenant', async () => {
    const s = buildStack();
    await seedT1(s);
    await issue(s, T2, APP_1, 'issue:pdp:1');
    expect(s.authorizer.calls.length).toBeGreaterThanOrEqual(9);
    for (const c of s.authorizer.calls) expect([T1, T2]).toContain(c.subject.tenant_id);
  });

  finding(
    'FINDING M07-INT-F01c: CMP-012 persists a tenant-B publish record for a credential id that exists only in tenant A',
    async () => {
      const s = buildStack();
      const t1 = await seedT1(s);
      const res = await s.call(
        'CMP-012',
        'POST',
        '/v1/digilocker-publish',
        {
          credential_id: t1.credentialId,
          consent_ref: 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
          purpose_code: 'CREDENTIAL_PUBLISH',
          document_type_ref: 'doctype:x',
          test_run_id: 'run',
        },
        { ctx: ctxFor(T2, 'SYSTEM') },
      );
      expect(leaks(res.body, [T1])).toBe(0);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(s.repos.digilocker.tenant(T2).publishRecords.size).toBe(0);
    },
  );

  it('aggregate: CROSS_TENANT_LEAKAGE = 0 across all tenant-negative probes', () => {
    expect(probes).toBeGreaterThanOrEqual(40);
    expect(leakage).toBe(0);
  });
});
