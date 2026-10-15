import type { RequestContext } from '@serviceform/contracts';
import type { M09PluginMounts } from '../../../../apps/api/src/composition/m09.js';
import { DOC, RecordingAuthorizer } from './fixtures.js';
import { RecordingPool } from './pool-double.js';

export const M09_EXPECTED = [
  'CMP-056',
  'CMP-057',
  'CMP-058',
  'CMP-059',
  'CMP-060',
  'CMP-061',
] as const;

export type M09Cmp = (typeof M09_EXPECTED)[number];
export type Probe = { cmp: M09Cmp; method: 'GET' | 'POST'; url: string; route: string };

export const READ_PROBES: readonly Probe[] = [
  { cmp: 'CMP-056', method: 'GET', url: `/v1/appointments/${DOC}`, route: '/v1/appointments/:appointment_id' },
  { cmp: 'CMP-056', method: 'GET', url: '/v1/appointments/slots', route: '/v1/appointments/slots' },
  { cmp: 'CMP-057', method: 'GET', url: `/v1/assisted/sessions/${DOC}`, route: '/v1/assisted/sessions/:session_id' },
  { cmp: 'CMP-058', method: 'GET', url: '/v1/elements', route: '/v1/elements' },
  { cmp: 'CMP-058', method: 'GET', url: '/v1/bindings', route: '/v1/bindings' },
  { cmp: 'CMP-059', method: 'GET', url: `/v1/migrations/${DOC}/reconciliation`, route: '/v1/migrations/:id/reconciliation' },
  { cmp: 'CMP-060', method: 'GET', url: `/v1/risk/assessments/${DOC}`, route: '/v1/risk/assessments/:assessmentId' },
  { cmp: 'CMP-061', method: 'GET', url: '/v1/privacy/me', route: '/v1/privacy/me' },
  { cmp: 'CMP-061', method: 'GET', url: `/v1/privacy/requests/${DOC}`, route: '/v1/privacy/requests/:request_id' },
];

export const WRITE_PROBES: readonly Probe[] = [
  { cmp: 'CMP-056', method: 'POST', url: '/v1/appointments', route: '/v1/appointments' },
  { cmp: 'CMP-057', method: 'POST', url: '/v1/assisted/sessions', route: '/v1/assisted/sessions' },
  { cmp: 'CMP-058', method: 'POST', url: '/v1/elements', route: '/v1/elements' },
  { cmp: 'CMP-059', method: 'POST', url: '/v1/migrations/projects', route: '/v1/migrations/projects' },
  { cmp: 'CMP-060', method: 'POST', url: '/v1/risk/assessments', route: '/v1/risk/assessments' },
  { cmp: 'CMP-061', method: 'POST', url: '/v1/privacy/requests', route: '/v1/privacy/requests' },
];

/** Records the tenant every service/port call saw, so a forged value would be observable. */
export class TenantRecorder {
  readonly seen: string[] = [];

  service(name: string): unknown {
    return new Proxy(
      {},
      {
        get: () =>
          async (...args: unknown[]) => {
            const ctx = args.find(
              (a): a is { tenant_id: string } =>
                typeof a === 'object' && a !== null && 'tenant_id' in a,
            );
            if (ctx) this.seen.push(ctx.tenant_id);
            return { status: 200, body: { id: DOC, echo: name } };
          },
      },
    );
  }

  riskAuthz(allow = true) {
    return {
      canActOnRisk: async (p: { tenant_id: string }) => {
        this.seen.push(p.tenant_id);
        return allow;
      },
    };
  }
}

export interface M09Harness {
  mounts: M09PluginMounts;
  recorder: TenantRecorder;
  semanticPool: RecordingPool;
  migrationPool: RecordingPool;
  riskPool: RecordingPool;
  semanticAuthz: RecordingAuthorizer;
  migrationAuthz: RecordingAuthorizer;
}

export function m09Harness(resolve: () => Promise<RequestContext | null>): M09Harness {
  const recorder = new TenantRecorder();
  const semanticPool = new RecordingPool();
  const migrationPool = new RecordingPool();
  const riskPool = new RecordingPool();
  const semanticAuthz = new RecordingAuthorizer();
  const migrationAuthz = new RecordingAuthorizer();
  return {
    recorder,
    semanticPool,
    migrationPool,
    riskPool,
    semanticAuthz,
    migrationAuthz,
    mounts: {
      scheduler: { service: recorder.service('scheduler'), resolveContext: resolve },
      assisted: { service: recorder.service('assisted'), resolveContext: resolve },
      semantic: {
        options: { pool: semanticPool, authorizer: semanticAuthz },
        resolveContext: resolve,
      },
      migration: {
        options: { pool: migrationPool, authorizer: migrationAuthz },
        resolveContext: resolve,
      },
      risk: {
        options: { pool: riskPool, authz: recorder.riskAuthz() },
        resolveContext: resolve,
      },
      privacy: { service: recorder.service('privacy'), resolveContext: resolve },
    },
  };
}
