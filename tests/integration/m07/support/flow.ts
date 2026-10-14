import { expect } from 'vitest';
import {
  APP_1,
  CONSENT_REF,
  ctxFor,
  DOCUMENT_TYPE_REF,
  PURPOSE_CODE,
  T1,
  TEST_RUN_ID,
  TYPE_REF,
} from './fixtures.js';
import type { Stack } from './wiring.js';

export const REG = '/v1/credential-registry/credentials';

export interface Issued {
  credentialId: string;
  credential: Record<string, unknown>;
}

/** Approval recorded upstream → POST /v1/credentials as the workflow SYSTEM principal. */
export async function issue(
  s: Stack,
  tenant = T1,
  app = APP_1,
  issuanceKey = `issue:${app.slice(0, 8)}:1`,
): Promise<Issued> {
  s.casePins.approve(tenant, app);
  const res = await s.call(
    'CMP-022',
    'POST',
    '/v1/credentials',
    { application_id: app, issuance_key: issuanceKey },
    { ctx: ctxFor(tenant, 'SYSTEM') },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { credentialId: res.body.credential_id as string, credential: res.body };
}

export async function registryStatus(s: Stack, tenant: string, credentialId: string) {
  return s.call('CMP-024', 'GET', `${REG}/${credentialId}/status`, undefined, {
    ctx: ctxFor(tenant, 'OFFICER'),
  });
}

export async function activate(s: Stack, tenant: string, credentialId: string): Promise<void> {
  const res = await s.call(
    'CMP-024',
    'POST',
    `${REG}/${credentialId}/activate`,
    { expected_version: 1 },
    { ctx: ctxFor(tenant, 'SYSTEM') },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

export async function mintQr(s: Stack, tenant: string, credentialId: string) {
  return s.call(
    'CMP-023',
    'POST',
    '/v1/qr/tokens',
    { credential_id: credentialId, credential_type_ref: TYPE_REF },
    { ctx: ctxFor(tenant, 'SYSTEM') },
  );
}

export async function verify(s: Stack, tenant: string, opaque: string) {
  return s.call('CMP-023', 'GET', `/v1/qr/verify/${opaque}`, undefined, {
    ctx: ctxFor(tenant, 'CITIZEN'),
  });
}

export async function publish(
  s: Stack,
  tenant: string,
  credentialId: string,
  extra: Record<string, unknown> = {},
) {
  return s.call(
    'CMP-012',
    'POST',
    '/v1/digilocker-publish',
    {
      credential_id: credentialId,
      consent_ref: CONSENT_REF,
      purpose_code: PURPOSE_CODE,
      document_type_ref: DOCUMENT_TYPE_REF,
      test_run_id: TEST_RUN_ID,
      ...extra,
    },
    { ctx: ctxFor(tenant, 'SYSTEM') },
  );
}

export async function credentialOf(s: Stack, tenant: string, credentialId: string) {
  return s.call('CMP-022', 'GET', `/v1/credentials/${credentialId}`, undefined, {
    ctx: ctxFor(tenant, 'OFFICER'),
  });
}

/** Full happy path to an ACTIVE credential with a minted QR token. */
export async function issueActiveWithQr(s: Stack, tenant = T1, app = APP_1) {
  const issued = await issue(s, tenant, app);
  await activate(s, tenant, issued.credentialId);
  const qr = await mintQr(s, tenant, issued.credentialId);
  expect(qr.status, JSON.stringify(qr.body)).toBe(201);
  return {
    ...issued,
    tokenId: qr.body.token.token_id as string,
    opaque: qr.body.token.opaque_token as string,
  };
}
