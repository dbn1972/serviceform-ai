import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_DESCRIPTORS as QR_ROUTES } from '../../../services/cmp-023-qr-verification/src/api/handler.js';
import { ROUTE_DESCRIPTORS as DL_ROUTES } from '../../../services/cmp-012-digilocker/src/api/handler.js';
import { ROUTE_DESCRIPTORS as CRED_ROUTES } from '../../../services/cmp-022-credential-engine/src/api/handler.js';
import { createCredentialStatusReadPort } from '../../../services/cmp-024-credential-registry/src/service/service.js';
import {
  makeHarness as h024,
  BASE,
} from '../../../services/cmp-024-credential-registry/test/doubles/harness.js';
import {
  ACTOR_CITIZEN,
  ACTOR_QR,
  CRED_1 as REG_CRED,
  TENANT_A as A024,
} from '../../../services/cmp-024-credential-registry/test/doubles/fixtures.js';
import type { MemoryRegistryRepository } from '../../../services/cmp-024-credential-registry/test/doubles/memory-repo.js';
import { makeHarness as h023 } from '../../../services/cmp-023-qr-verification/test/doubles/harness.js';
import {
  CRED_1 as QR_CRED,
  issueBody,
  publicVerifierCtx,
  TENANT_A as A023,
} from '../../../services/cmp-023-qr-verification/test/doubles/fixtures.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function srcOf(cmpDir: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && p.endsWith('.ts')) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(join(ROOT, 'services', cmpDir, 'src'));
  return out.join('\n');
}

const STATUS_VERBS = /\b(activate|suspend|reinstate|revoke|reissue)\b/i;

describe('SF-M07-SEC status authority: only CMP-024 can mutate credential status', () => {
  it('CMP-023 publishes no route that writes a status; only token mint + two reads', () => {
    expect(QR_ROUTES.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /v1/qr/tokens',
      'GET /v1/qr/tokens/:token_id',
      'GET /v1/qr/verify/:opaque_token',
    ]);
    for (const r of QR_ROUTES) expect(r.path, r.path).not.toMatch(STATUS_VERBS);
    for (const r of [...DL_ROUTES, ...CRED_ROUTES])
      expect(r.path, r.path).not.toMatch(STATUS_VERBS);
  });

  it('CMP-023 registry port is a single getStatus read; source has no registry write path or SQL', () => {
    const port = readFileSync(
      join(ROOT, 'services/cmp-023-qr-verification/src/ports/registry-status-port.ts'),
      'utf8',
    );
    const methods = [...port.matchAll(/^\s+(\w+)\(/gm)].map((m) => m[1]);
    expect(methods).toEqual(['getStatus']);
    const qr = srcOf('cmp-023-qr-verification');
    expect(qr).not.toMatch(/cmp-024-credential-registry/);
    expect(qr).not.toMatch(/sf_credential_registry|sf_credential\./);
    expect(qr).not.toMatch(/\.(transition|revoke|suspend|reinstate|reissue|register)\(/);
  });

  it('CMP-012 and CMP-022 have no registry mutation path (CMP-022 may only register)', () => {
    const dl = srcOf('cmp-012-digilocker');
    expect(dl).not.toMatch(/cmp-024|sf_credential_registry|RegistryStatusPort/);
    const reg022 = readFileSync(
      join(ROOT, 'services/cmp-022-credential-engine/src/ports/registry-port.ts'),
      'utf8',
    );
    const iface = reg022.slice(reg022.indexOf('interface CredentialRegistryPort'));
    const methods = [...iface.slice(0, iface.indexOf('}')).matchAll(/^\s+(\w+)\(/gm)].map(
      (m) => m[1],
    );
    expect(methods).toEqual(['register']);
    expect(srcOf('cmp-022-credential-engine')).not.toMatch(/sf_credential_registry/);
  });

  it('CMP-024 read port handed to verifiers is frozen with exactly one read', async () => {
    const h = h024();
    await h.active(REG_CRED);
    const port = createCredentialStatusReadPort(h.service);
    expect(Object.isFrozen(port)).toBe(true);
    expect(Object.keys(port)).toEqual(['getStatus']);
    expect(() => {
      (port as unknown as Record<string, unknown>)['transition'] = () => undefined;
    }).toThrow();
    expect((port as unknown as Record<string, unknown>)['transition']).toBeUndefined();
  });

  it('QR workload (INTEGRATION) and citizens cannot mutate status even when OPA would allow', async () => {
    const h = h024();
    await h.active(REG_CRED);
    const repo = h.repo as MemoryRegistryRepository;
    const state = () => {
      const s = repo.snapshot(A024) as { entries: unknown; history: unknown };
      return JSON.stringify([s.entries, s.history]);
    };
    const before = state();
    for (const [actor, type] of [
      [ACTOR_QR, 'INTEGRATION'],
      [ACTOR_CITIZEN, 'CITIZEN'],
    ] as const) {
      h.as(A024, actor, type);
      for (const verb of ['suspend', 'revoke', 'reinstate', 'activate']) {
        const res = await h.transition(REG_CRED, verb, 2, h.reason);
        expect(res.status, `${type} ${verb}`).toBe(403);
        expect(res.body['details']?.[0]?.code).toBe('ACTOR_NOT_PERMITTED');
      }
      const reg = await h.call('POST', BASE, {
        credential_id: '55555555-5555-4555-8555-555555555555',
        issuer_ref: 'issuer:tenant-meta:0001',
      });
      expect(reg.status, `${type} register`).toBe(403);
    }
    expect(state()).toBe(before);
  });

  it('QR verify reflects a CMP-024 revocation live and fails closed on registry outage', async () => {
    const h = h023();
    const issued = await h.call('POST', '/v1/qr/tokens', issueBody());
    const opaque = (issued.body as Body)['token']['opaque_token'] as string;
    h.state.ctx = publicVerifierCtx(A023);
    const ok = await h.call('GET', `/v1/qr/verify/${opaque}`);
    expect((ok.body as Body)['public_view']['registry_status']).toBe('ACTIVE');
    h.registry.setStatus(A023, QR_CRED, 'REVOKED');
    const revoked = await h.call('GET', `/v1/qr/verify/${opaque}`);
    expect((revoked.body as Body)['public_view']['registry_status']).toBe('REVOKED');
    expect(revoked.headers['cache-control']).toBe('no-store');
    h.registry.fail = true;
    const down = await h.call('GET', `/v1/qr/verify/${opaque}`);
    expect(down.status).toBe(503);
    expect(JSON.stringify(down.body)).not.toMatch(/ACTIVE|REVOKED/);
  });

  it('public verify view is purpose-minimised: no tenant, credential, token id or holder fields', async () => {
    const h = h023();
    const issued = await h.call('POST', '/v1/qr/tokens', issueBody());
    const token = (issued.body as Body)['token'];
    h.state.ctx = publicVerifierCtx(A023);
    const res = await h.call('GET', `/v1/qr/verify/${token['opaque_token'] as string}`);
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    for (const secret of [
      A023,
      QR_CRED,
      token['token_id'] as string,
      token['opaque_token'] as string,
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys((res.body as Body)['public_view']).sort()).toEqual(
      expect.arrayContaining([
        'credential_type_ref',
        'issuer_ref',
        'registry_status',
        'status_checked_at',
      ]),
    );
    expect(text).not.toMatch(/holder|name|dob|aadhaar|mobile|email|address/i);
  });
});
