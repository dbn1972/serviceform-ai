import { describe, expect, it } from 'vitest';
import { createCredentialApi } from '../../../services/cmp-022-credential-engine/src/api/handler.js';
import { createRegistryApi } from '../../../services/cmp-024-credential-registry/src/api/handler.js';
import { createQrApi } from '../../../services/cmp-023-qr-verification/src/api/handler.js';
import { createDigilockerApi } from '../../../services/cmp-012-digilocker/src/api/handler.js';
import type { RequestContext } from '../../../packages/contracts/src/index.js';
import { ALL_ROUTES, CANARY, CTX, ServiceProbe, type Cmp } from './helpers.js';

/**
 * Defence in depth below the CMP-036 edge: each component's transport-neutral handler is called
 * directly, as any future non-gateway caller (worker, test host, second ingress) would.
 */
type Handler = {
  handle(req: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: unknown;
  }): Promise<{ status: number; body: unknown }>;
};

function apis(
  resolve: () => Promise<RequestContext | null>,
): Record<Cmp, { api: Handler; probe: ServiceProbe }> {
  const p022 = new ServiceProbe([
    'get',
    'listSigningRecords',
    'listForApplication',
    'issue',
    'recordDownstreamOutcome',
  ]);
  const p024 = new ServiceProbe(['readStatus', 'register', 'transition']);
  const p023 = new ServiceProbe(['getToken', 'verify', 'issueToken']);
  const p012 = new ServiceProbe(['getPublishRecord', 'publishCredential']);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return {
    'CMP-022': {
      api: createCredentialApi({
        service: p022.service as any,
        resolveContext: resolve,
      }) as Handler,
      probe: p022,
    },
    'CMP-024': {
      api: createRegistryApi({ service: p024.service as any, resolveContext: resolve }) as Handler,
      probe: p024,
    },
    'CMP-023': {
      api: createQrApi({ service: p023.service as any, resolveContext: resolve }) as Handler,
      probe: p023,
    },
    'CMP-012': {
      api: createDigilockerApi({
        service: p012.service as any,
        resolveContext: resolve,
      }) as Handler,
      probe: p012,
    },
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

const GET_ROUTES = ALL_ROUTES.filter((r) => r.method === 'GET');

async function statusFor(
  cmp: Cmp,
  headers: Record<string, string>,
  resolve = () => Promise.resolve(CTX as RequestContext | null),
) {
  const set = apis(resolve)[cmp];
  const route = GET_ROUTES.find((r) => r.cmp === cmp);
  if (!route) throw new Error(`no GET route for ${cmp}`);
  const res = await set.api.handle({ method: 'GET', path: route.url, headers });
  return { res, hits: set.probe.hits };
}

describe('SF-M07-SEC component-level tenant header guards (defence in depth)', () => {
  it('CMP-022/023/024 refuse tenant- and identity-asserting headers themselves', async () => {
    for (const cmp of ['CMP-022', 'CMP-024', 'CMP-023'] as const) {
      for (const h of [
        'x-tenant-id',
        'x-sf-tenant',
        'x-roles',
        'x-actor-type',
        'x-assurance',
        'x-org-id',
      ]) {
        const { res, hits } = await statusFor(cmp, { [h]: CANARY });
        expect(res.status, `${cmp} ${h}`).toBe(403);
        expect(res.body).toMatchObject({ error_code: 'SF-TEN-002' });
        expect(JSON.stringify(res.body)).not.toContain(CANARY);
        expect(hits).toBe(0);
      }
      const fwd = await statusFor(cmp, { forwarded: `for=192.0.2.1;tenant=${CANARY}` });
      expect(fwd.res.status, `${cmp} forwarded`).toBe(403);
    }
  });

  it('FINDING M07-SEC-F01: CMP-012 component guard only blocks three header names', async () => {
    const accepted: string[] = [];
    for (const h of [
      'x-tenant-id',
      'x-sf-tenant',
      'x-roles',
      'x-actor-type',
      'x-assurance',
      'x-org-id',
      'forwarded',
    ]) {
      const value = h === 'forwarded' ? `for=192.0.2.1;tenant=${CANARY}` : CANARY;
      const { res } = await statusFor('CMP-012', { [h]: value });
      if (res.status !== 403) accepted.push(h);
    }
    // Characterises the current gap. The CMP-036 edge still refuses all of these
    // (host-forged-tenant.test.ts), so there is no exploitable path through the API host today.
    expect(accepted).toEqual([
      'x-tenant-id',
      'x-sf-tenant',
      'x-roles',
      'x-actor-type',
      'x-assurance',
      'x-org-id',
      'forwarded',
    ]);
    for (const h of ['x-real-tenant-id', 'x-bypass-rls', 'x-override-tenant']) {
      const { res, hits } = await statusFor('CMP-012', { [h]: CANARY });
      expect(res.status, h).toBe(403);
      expect(hits).toBe(0);
    }
  });

  it('a forged header never changes the tenant the service receives', async () => {
    for (const cmp of ['CMP-022', 'CMP-024', 'CMP-023', 'CMP-012'] as const) {
      const set = apis(() => Promise.resolve(CTX));
      const seen: string[] = [];
      for (const name of Object.keys(set[cmp].probe.service)) {
        set[cmp].probe.service[name] = (ctx: unknown) => {
          seen.push((ctx as RequestContext).tenant_id ?? 'null');
          return Promise.resolve({ status: 200, body: {} });
        };
      }
      const route = GET_ROUTES.find((r) => r.cmp === cmp);
      await set[cmp].api.handle({
        method: 'GET',
        path: route?.url ?? '',
        headers: { 'x-tenant-id': CANARY },
      });
      expect(
        seen.every((t) => t === CTX.tenant_id),
        cmp,
      ).toBe(true);
    }
  });

  it('CMP-022/023/024 reject malformed server contexts (non-UUID tenant, missing actor)', async () => {
    const bad: RequestContext[] = [
      { ...CTX, tenant_id: 'not-a-uuid' },
      { ...CTX, actor: { type: 'OFFICER', id: 'nope' } },
      { ...CTX, tenant_id: null },
    ];
    for (const cmp of ['CMP-022', 'CMP-024', 'CMP-023'] as const) {
      for (const ctx of bad) {
        const { res, hits } = await statusFor(cmp, {}, () => Promise.resolve(ctx));
        expect([401, 403], `${cmp} ${JSON.stringify(ctx.tenant_id)}`).toContain(res.status);
        expect(hits).toBe(0);
      }
    }
  });

  it('FINDING M07-SEC-F02: CMP-012 accepts a malformed server context (non-UUID tenant, bad actor id)', async () => {
    const passes: string[] = [];
    for (const [label, ctx] of [
      ['non-uuid-tenant', { ...CTX, tenant_id: 'not-a-uuid' }],
      ['bad-actor-id', { ...CTX, actor: { type: 'OFFICER', id: 'nope' } }],
    ] as const) {
      const { hits } = await statusFor('CMP-012', {}, () => Promise.resolve(ctx as RequestContext));
      if (hits > 0) passes.push(label);
    }
    expect(passes).toEqual(['non-uuid-tenant', 'bad-actor-id']);
    // Null tenant is still refused.
    const nul = await statusFor('CMP-012', {}, () => Promise.resolve({ ...CTX, tenant_id: null }));
    expect([401, 403]).toContain(nul.res.status);
    expect(nul.hits).toBe(0);
  });
});
