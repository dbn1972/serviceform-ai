import { Writable } from 'node:stream';
import type { RequestContext } from '../../../packages/contracts/src/index.js';
import { createLogger } from '../../../packages/observability/src/index.js';
import { loadConfig } from '../../../apps/api/src/config.js';
import type { M07PluginMounts } from '../../../apps/api/src/composition/m07.js';

/** Synthetic identifiers only. No real tenant, holder or official data. */
export const T1 = '11111111-1111-4111-8111-111111111111';
export const DOC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const CANARY = '00000000-0000-4000-8000-0000000000a7';
export const OPAQUE = 'sec-probe-opaque-token-000000000000000000000';

export const hostConfig = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-m07-sec',
  LOG_LEVEL: 'info',
  SF_GATEWAY_RATE_LIMIT_MAX: '100000',
});

export const CTX: RequestContext = {
  tenant_id: T1,
  cell_id: 'cell-local',
  actor: { type: 'OFFICER', id: '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42' },
  roles: ['SERVICE_CHECKER'],
  jurisdiction_ids: ['5fad7b4e-a06c-4d9e-b15f-8c4d2e6a0b75'],
  auth_assurance: 'MFA',
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  trace_id: '0af7651916cd43dd8448eb211c80319c',
};

export function capturingLogger(lines: string[]) {
  const destination = new Writable({
    write(chunk: Buffer, _e, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return createLogger({ service: 'm07-sec', version: 'test', level: 'info', destination });
}

export type Cmp = 'CMP-022' | 'CMP-024' | 'CMP-023' | 'CMP-012';

/** Every M07 route published by the four components (SF-M07-005 handover inventory). */
export const ALL_ROUTES: ReadonlyArray<{ cmp: Cmp; method: 'GET' | 'POST'; url: string }> = [
  { cmp: 'CMP-022', method: 'POST', url: '/v1/credentials' },
  { cmp: 'CMP-022', method: 'GET', url: `/v1/credentials/${DOC}` },
  { cmp: 'CMP-022', method: 'GET', url: `/v1/credentials/${DOC}/signing-records` },
  { cmp: 'CMP-022', method: 'POST', url: `/v1/credentials/${DOC}/downstream-outcomes` },
  { cmp: 'CMP-022', method: 'GET', url: `/v1/applications/${DOC}/credentials` },
  { cmp: 'CMP-024', method: 'POST', url: '/v1/credential-registry/credentials' },
  { cmp: 'CMP-024', method: 'GET', url: `/v1/credential-registry/credentials/${DOC}/status` },
  ...(['activate', 'suspend', 'reinstate', 'revoke', 'reissue'] as const).map((verb) => ({
    cmp: 'CMP-024' as const,
    method: 'POST' as const,
    url: `/v1/credential-registry/credentials/${DOC}/${verb}`,
  })),
  { cmp: 'CMP-023', method: 'POST', url: '/v1/qr/tokens' },
  { cmp: 'CMP-023', method: 'GET', url: `/v1/qr/tokens/${DOC}` },
  { cmp: 'CMP-023', method: 'GET', url: `/v1/qr/verify/${OPAQUE}` },
  { cmp: 'CMP-012', method: 'POST', url: '/v1/digilocker-publish' },
  { cmp: 'CMP-012', method: 'GET', url: `/v1/digilocker-publish/${DOC}` },
];

/**
 * Header spellings a client might use to assert a tenant or identity. Every one must be refused
 * with SF-TEN-002 at the host edge.
 */
export const FORGED_HEADER_SETS: ReadonlyArray<Record<string, string>> = [
  { 'x-tenant-id': CANARY },
  { 'X-Tenant-ID': CANARY },
  { 'x-tenant': CANARY },
  { 'x-sf-tenant-id': CANARY },
  { 'x-real-tenant-id': CANARY },
  { 'x-override-tenant': CANARY },
  { forwarded: `for=192.0.2.1;tenant=${CANARY}` },
  { 'x-roles': 'PRIVILEGED_ADMIN' },
  { 'x-actor-type': 'SYSTEM' },
  { 'x-assurance': 'MFA' },
  { 'x-org-id': CANARY },
];

export class ServiceProbe {
  hits = 0;
  readonly service: Record<string, (...args: unknown[]) => Promise<unknown>>;
  constructor(methods: readonly string[]) {
    this.service = {};
    for (const m of methods) {
      this.service[m] = () => {
        this.hits += 1;
        return Promise.resolve({ status: 200, body: { id: DOC } });
      };
    }
  }
}

export function probedMounts(
  resolveContext: () => Promise<RequestContext | null> = () => Promise.resolve(CTX),
): { mounts: M07PluginMounts; probes: Record<Cmp, ServiceProbe> } {
  const probes: Record<Cmp, ServiceProbe> = {
    'CMP-022': new ServiceProbe([
      'get',
      'listSigningRecords',
      'listForApplication',
      'issue',
      'recordDownstreamOutcome',
    ]),
    'CMP-024': new ServiceProbe(['readStatus', 'register', 'transition']),
    'CMP-023': new ServiceProbe(['getToken', 'verify', 'issueToken']),
    'CMP-012': new ServiceProbe(['getPublishRecord', 'publishCredential']),
  };
  return {
    probes,
    mounts: {
      credential: { service: probes['CMP-022'].service, resolveContext },
      registry: { service: probes['CMP-024'].service, resolveContext },
      qr: { service: probes['CMP-023'].service, resolveContext },
      digilocker: { service: probes['CMP-012'].service, resolveContext },
    },
  };
}

export function totalHits(probes: Record<Cmp, ServiceProbe>): number {
  return Object.values(probes).reduce((n, p) => n + p.hits, 0);
}
