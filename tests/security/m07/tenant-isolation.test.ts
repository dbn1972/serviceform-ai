import { describe, expect, it } from 'vitest';
import { credentialIdFor } from '../../../services/cmp-022-credential-engine/src/domain/credential.js';
import { makeHarness as h022 } from '../../../services/cmp-022-credential-engine/test/doubles/harness.js';
import {
  APPLICATION_ID,
  ctxFor as ctx022,
  ISSUANCE_KEY,
  TENANT_A as A022,
  TENANT_B as B022,
} from '../../../services/cmp-022-credential-engine/test/doubles/fixtures.js';
import {
  makeHarness as h024,
  BASE,
} from '../../../services/cmp-024-credential-registry/test/doubles/harness.js';
import {
  ACTOR_OFFICER,
  CRED_1 as REG_CRED,
  TENANT_A as A024,
  TENANT_B as B024,
} from '../../../services/cmp-024-credential-registry/test/doubles/fixtures.js';
import type { MemoryRegistryRepository } from '../../../services/cmp-024-credential-registry/test/doubles/memory-repo.js';
import { makeHarness as h023 } from '../../../services/cmp-023-qr-verification/test/doubles/harness.js';
import {
  CRED_1 as QR_CRED,
  ctxFor as ctx023,
  issueBody,
  publicVerifierCtx,
  TENANT_A as A023,
  TENANT_B as B023,
} from '../../../services/cmp-023-qr-verification/test/doubles/fixtures.js';
import { makeHarness as h012 } from '../../../services/cmp-012-digilocker/test/doubles/harness.js';
import {
  CONSENT_REF,
  CREDENTIAL_ID,
  DOCUMENT_TYPE_REF,
  PURPOSE_CODE,
  TENANT_A as A012,
  TENANT_B as B012,
} from '../../../services/cmp-012-digilocker/test/doubles/fixtures.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const leaks = (bodies: unknown[], needles: string[]) =>
  needles.filter((n) => JSON.stringify(bodies).includes(n)).length;

describe('SF-M07-SEC tenant isolation (wrong-tenant / IDOR) — CROSS_TENANT_LEAKAGE must be 0', () => {
  it('CMP-022: tenant B cannot read, list, or attach outcomes to tenant A credentials', async () => {
    const h = h022();
    const issue = { application_id: APPLICATION_ID, issuance_key: ISSUANCE_KEY };
    expect((await h.call('POST', '/v1/credentials', issue)).status).toBe(201);
    const idA = credentialIdFor(A022, APPLICATION_ID, ISSUANCE_KEY);
    h.state.ctx = ctx022(B022);
    const get = await h.call('GET', `/v1/credentials/${idA}`, undefined, { key: null });
    const rec = await h.call('GET', `/v1/credentials/${idA}/signing-records`, undefined, {
      key: null,
    });
    const list = await h.call('GET', `/v1/applications/${APPLICATION_ID}/credentials`, undefined, {
      key: null,
    });
    expect(get.status).toBe(404);
    expect(rec.status).toBe(404);
    expect((list.body as Body)['credentials']).toEqual([]);
    h.state.ctx = ctx022(B022, undefined, 'INTEGRATION');
    const out = await h.call('POST', `/v1/credentials/${idA}/downstream-outcomes`, {
      channel: 'DIGILOCKER_PUBLISH',
      outcome: 'FAILED',
      outcome_ref: 'dispatch:0001',
      failure_code: 'SF-INT-001',
    });
    expect(out.status).toBe(404);
    expect(h.repo.tenant(A022).outcomes).toHaveLength(0);
    expect(leaks([get.body, rec.body, list.body, out.body], [A022, idA])).toBe(0);
  });

  it('CMP-024: tenant B cannot read or mutate (suspend/revoke/reissue) tenant A registry status', async () => {
    const h = h024();
    await h.active(REG_CRED, A024);
    const repo = h.repo as MemoryRegistryRepository;
    const before = JSON.stringify(repo.snapshot(A024));
    h.as(B024, ACTOR_OFFICER, 'OFFICER');
    const bodies: unknown[] = [];
    const read = await h.call('GET', `${BASE}/${REG_CRED}/status`);
    bodies.push(read.body);
    expect(read.status).toBe(404);
    for (const verb of ['suspend', 'revoke']) {
      const res = await h.transition(REG_CRED, verb, 2, h.reason);
      bodies.push(res.body);
      expect(res.status, verb).toBe(404);
    }
    expect(JSON.stringify(repo.snapshot(A024))).toBe(before);
    expect(leaks(bodies, [A024])).toBe(0);
  });

  it('CMP-024: tenant B cannot reissue onto a tenant A credential id as successor', async () => {
    const h = h024();
    await h.active(REG_CRED, A024);
    const other = '55555555-5555-4555-8555-555555555555';
    await h.active(other, B024);
    const res = await h.transition(other, 'reissue', 2, {
      ...h.reason,
      superseded_by_credential_id: REG_CRED,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('CMP-023: tenant A opaque token does not verify under tenant B; token id is not an IDOR', async () => {
    const h = h023();
    const issued = await h.call('POST', '/v1/qr/tokens', issueBody());
    expect(issued.status).toBe(201);
    const token = (issued.body as Body)['token'];
    h.state.ctx = publicVerifierCtx(B023);
    const verify = await h.call('GET', `/v1/qr/verify/${token['opaque_token'] as string}`);
    expect(verify.status).toBe(404);
    h.state.ctx = ctx023(B023);
    const read = await h.call('GET', `/v1/qr/tokens/${token['token_id'] as string}`);
    expect(read.status).toBe(404);
    expect(leaks([verify.body, read.body], [A023, QR_CRED, token['token_id'] as string])).toBe(0);
  });

  it('CMP-023: a registry/credential port answering with another tenant record is refused (SF-TEN-002)', async () => {
    const h = h023();
    h.registry.respondWith = {
      tenant_id: B023,
      credential_id: QR_CRED,
      issuer_ref: 'issuer:tenant-meta:0001',
      status_authority_cmp: 'CMP-024',
      current_status: 'ACTIVE',
    };
    const res = await h.call('POST', '/v1/qr/tokens', issueBody());
    expect(res.status).toBe(403);
    expect((res.body as Body)['error_code']).toBe('SF-TEN-002');
    expect(JSON.stringify(res.body)).not.toContain(B023);
    h.registry.respondWith = undefined;
    h.credentials.respondWith = {
      tenant_id: B023,
      credential_id: QR_CRED,
      lifecycle_status: 'ISSUED',
      issued_at: '2026-10-14T04:00:00.000Z',
      artifacts: [],
    };
    const res2 = await h.call('POST', '/v1/qr/tokens', issueBody());
    expect(res2.status).toBe(403);
    expect((res2.body as Body)['error_code']).toBe('SF-TEN-002');
  });

  it('CMP-012: tenant B cannot read tenant A publish records', async () => {
    const h = h012();
    const created = await h.call('POST', '/v1/digilocker-publish', {
      credential_id: CREDENTIAL_ID,
      consent_ref: CONSENT_REF,
      purpose_code: PURPOSE_CODE,
      document_type_ref: DOCUMENT_TYPE_REF,
      test_run_id: 'test-run-001',
    });
    expect(created.status).toBe(201);
    const id = (created.body as Body)['publish_request_id'] as string;
    h.state.ctx = { ...h.state.ctx, tenant_id: B012 };
    const r = await h.call('GET', `/v1/digilocker-publish/${id}`);
    expect(r.status).toBe(404);
    expect(leaks([r.body], [A012, CREDENTIAL_ID, CONSENT_REF])).toBe(0);
    expect(h.repo.stores.get(B012)?.publishRecords.size ?? 0).toBe(0);
  });
});
