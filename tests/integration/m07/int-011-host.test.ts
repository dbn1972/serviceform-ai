import { Writable } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { validate, type RequestContext } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import { buildApp } from '../../../apps/api/src/app.js';
import { loadConfig } from '../../../apps/api/src/config.js';
import type { M07PluginMounts } from '../../../apps/api/src/composition/m07.js';
import {
  APP_1,
  CANARY,
  CONSENT_REF,
  ctxFor,
  DOCUMENT_TYPE_REF,
  leaks,
  PURPOSE_CODE,
  T1,
  T2,
  TEST_RUN_ID,
  TYPE_REF,
  type ActorType,
} from './support/fixtures.js';
import { REG } from './support/flow.js';
import { buildStack, type Stack } from './support/wiring.js';

/**
 * INT-008 + INT-011 through the real API host (CMP-036 gateway + M07 composition from
 * SF-M07-005) with the real CMP-022/024/023/012 services behind it. The host resolves tenant
 * context server-side from an opaque session handle; headers never carry tenant identity.
 */

const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-m07-int',
  LOG_LEVEL: 'silent',
  SF_GATEWAY_RATE_LIMIT_MAX: '10000',
});

function silentLogger() {
  const destination = new Writable({
    write(_c: Buffer, _e, cb) {
      cb();
    },
  });
  return createLogger({ service: 'm07-int', version: 'test', level: 'silent', destination });
}

/** Server-side session table: opaque bearer handle → resolved RequestContext. */
const SESSIONS: Record<string, [string, ActorType]> = {
  't1-system': [T1, 'SYSTEM'],
  't1-officer': [T1, 'OFFICER'],
  't1-citizen': [T1, 'CITIZEN'],
  't2-system': [T2, 'SYSTEM'],
  't2-officer': [T2, 'OFFICER'],
  't2-citizen': [T2, 'CITIZEN'],
};

async function resolveFromSession(request: FastifyRequest): Promise<RequestContext | null> {
  const auth = request.headers['authorization'];
  const handle = typeof auth === 'string' ? auth.replace(/^Bearer /, '') : '';
  const entry = SESSIONS[handle];
  return entry ? (ctxFor(entry[0], entry[1]) as RequestContext) : null;
}

function mounts(s: Stack): M07PluginMounts {
  const resolveContext = resolveFromSession;
  return {
    credential: { service: s.services.credential, resolveContext },
    registry: { service: s.services.registry, resolveContext },
    qr: { service: s.services.qr, resolveContext },
    digilocker: { service: s.services.digilocker, resolveContext },
  };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

let seq = 0;
async function http(
  method: 'GET' | 'POST',
  url: string,
  session: string | null,
  payload?: unknown,
  extra: Record<string, string> = {},
) {
  seq += 1;
  const headers: Record<string, string> = { ...extra };
  if (session) headers['authorization'] = `Bearer ${session}`;
  if (method === 'POST') headers['idempotency-key'] = `m07-host-${String(seq).padStart(6, '0')}`;
  const res = await (app as FastifyInstance).inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: res.statusCode, body: res.json() as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function hostChain(s: Stack) {
  s.casePins.approve(T1, APP_1);
  const issued = await http('POST', '/v1/credentials', 't1-system', {
    application_id: APP_1,
    issuance_key: 'issue:host:1',
  });
  expect(issued.status, JSON.stringify(issued.body)).toBe(201);
  const credentialId = issued.body['credential_id'] as string;
  const act = await http('POST', `${REG}/${credentialId}/activate`, 't1-system', {
    expected_version: 1,
  });
  expect(act.status, JSON.stringify(act.body)).toBe(200);
  const qr = await http('POST', '/v1/qr/tokens', 't1-system', {
    credential_id: credentialId,
    credential_type_ref: TYPE_REF,
  });
  expect(qr.status, JSON.stringify(qr.body)).toBe(201);
  const pub = await http('POST', '/v1/digilocker-publish', 't1-system', {
    credential_id: credentialId,
    consent_ref: CONSENT_REF,
    purpose_code: PURPOSE_CODE,
    document_type_ref: DOCUMENT_TYPE_REF,
    test_run_id: TEST_RUN_ID,
  });
  expect(pub.status, JSON.stringify(pub.body)).toBe(201);
  return {
    credentialId,
    tokenId: qr.body['token']['token_id'] as string,
    opaque: qr.body['token']['opaque_token'] as string,
    publishId: pub.body['publish_request_id'] as string,
  };
}

describe('INT-008/INT-011 through the API host with real M07 services', () => {
  it('mounts all four real M07 services and runs approval → sign → issue → QR → DigiLocker over HTTP', async () => {
    const s = buildStack();
    app = await buildApp(config, { logger: silentLogger(), m07: mounts(s) });
    expect(app.m07Mounted).toEqual(['CMP-022', 'CMP-024', 'CMP-023', 'CMP-012']);
    const chain = await hostChain(s);

    const verified = await http('GET', `/v1/qr/verify/${chain.opaque}`, 't1-citizen');
    expect(verified.status).toBe(200);
    expect(verified.body['public_view']['registry_status']).toBe('ACTIVE');
    expect(JSON.stringify(verified.body)).not.toContain(chain.credentialId);

    const cred = await http('GET', `/v1/credentials/${chain.credentialId}`, 't1-officer');
    expect(cred.body['lifecycle_status']).toBe('ISSUED');
    const status = await http('GET', `${REG}/${chain.credentialId}/status`, 't1-officer');
    expect(status.body['credential_status']['current_status']).toBe('ACTIVE');
  });

  it('tenant-B sessions get 404 for every tenant-A resource through the host; CROSS_TENANT_LEAKAGE = 0', async () => {
    const s = buildStack();
    app = await buildApp(config, { logger: silentLogger(), m07: mounts(s) });
    const c = await hostChain(s);
    const foreign = [T1, c.credentialId, c.tokenId, c.opaque, c.publishId];
    let leakage = 0;
    const reads = [
      `/v1/credentials/${c.credentialId}`,
      `/v1/credentials/${c.credentialId}/signing-records`,
      `${REG}/${c.credentialId}/status`,
      `/v1/qr/tokens/${c.tokenId}`,
      `/v1/digilocker-publish/${c.publishId}`,
    ];
    for (const url of reads) {
      const res = await http('GET', url, 't2-officer');
      expect(res.status, url).toBe(404);
      leakage += leaks(res.body, foreign);
    }
    const verify = await http('GET', `/v1/qr/verify/${c.opaque}`, 't2-citizen');
    expect(verify.status).toBe(404);
    leakage += leaks(verify.body, foreign);
    const list = await http('GET', `/v1/applications/${APP_1}/credentials`, 't2-officer');
    expect(list.body['credentials']).toEqual([]);
    leakage += leaks(list.body, foreign);
    const revoke = await http('POST', `${REG}/${c.credentialId}/revoke`, 't2-system', {
      expected_version: 2,
      reason_code_ref: 'reason:x',
    });
    expect(revoke.status).toBe(404);
    leakage += leaks(revoke.body, foreign);
    expect(leakage).toBe(0);
    expect(s.repos.registry.tenant(T1).entries.get(c.credentialId)?.current_status).toBe('ACTIVE');
  });

  it('forged tenant headers are refused with SF-TEN-002 by the host on every M07 route (incl. CMP-012)', async () => {
    const s = buildStack();
    app = await buildApp(config, { logger: silentLogger(), m07: mounts(s) });
    const c = await hostChain(s);
    const routes: Array<['GET' | 'POST', string]> = [
      ['GET', `/v1/credentials/${c.credentialId}`],
      ['GET', `/v1/credentials/${c.credentialId}/signing-records`],
      ['GET', `/v1/applications/${APP_1}/credentials`],
      ['POST', '/v1/credentials'],
      ['POST', `/v1/credentials/${c.credentialId}/downstream-outcomes`],
      ['GET', `${REG}/${c.credentialId}/status`],
      ['POST', REG],
      ['POST', `${REG}/${c.credentialId}/suspend`],
      ['GET', `/v1/qr/tokens/${c.tokenId}`],
      ['GET', `/v1/qr/verify/${c.opaque}`],
      ['POST', '/v1/qr/tokens'],
      ['GET', `/v1/digilocker-publish/${c.publishId}`],
      ['POST', '/v1/digilocker-publish'],
    ];
    const writesBefore = s.repos.digilocker.tenant(T1).publishRecords.size;
    for (const [method, url] of routes) {
      for (const forged of [{ 'x-tenant-id': CANARY }, { 'X-Tenant-ID': T2, 'x-tenant': CANARY }]) {
        const res = await http(
          method,
          url,
          't1-system',
          method === 'POST' ? {} : undefined,
          forged,
        );
        expect(res.status, `${method} ${url}`).toBe(403);
        expect(validate('error-response', res.body).valid).toBe(true);
        expect(res.body['error_code']).toBe('SF-TEN-002');
        expect(JSON.stringify(res.body)).not.toContain(CANARY);
      }
    }
    expect(s.repos.digilocker.tenant(T1).publishRecords.size).toBe(writesBefore);
  });

  it('missing server session fails closed on every M07 route (401/403, SF-AUTH/SF-TEN)', async () => {
    const s = buildStack();
    app = await buildApp(config, { logger: silentLogger(), m07: mounts(s) });
    const id = 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0';
    for (const url of [
      `/v1/credentials/${id}`,
      `${REG}/${id}/status`,
      `/v1/qr/tokens/${id}`,
      `/v1/digilocker-publish/${id}`,
    ]) {
      const res = await http('GET', url, null);
      expect([401, 403], url).toContain(res.status);
      expect(res.body['error_code']).toMatch(/^SF-(AUTH|TEN)-00/);
    }
  });
});
