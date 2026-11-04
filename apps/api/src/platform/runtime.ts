import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ApplicationCaseService,
  DenyServicePolicyPort,
  PgCaseStore,
  SimulatedPublishedBindingPort,
  type DeploymentEnvironment,
  type PublishedBinding,
} from '@serviceform/cmp-015-application-case';
import { OpaPdpClient } from '@serviceform/security';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import type { M02PluginMounts } from '../composition/m02.js';
import type { M05PluginMounts } from '../composition/m05.js';
import type { ReadinessCheck } from '../plugins/health.js';
import {
  placementContextResolver,
  type PrincipalPort,
  type SessionContextPort,
} from './context.js';
import { loadPlacement, type PortalPlacement } from './placement.js';
import {
  assertSimulatorEnvironment,
  registerLabSimulators,
  SimulatedOtpInbox,
  type LabOfficer,
  type MintAssertion,
  type OtpAdapterLike,
} from './simulators.js';

/**
 * SF-M10-B-2 SAMPLE_LAB platform host: CMP-004 identity + CMP-015 application/case on
 * PostgreSQL (FORCE RLS, one runtime login per component per ADR-0006) with real OPA as the PDP.
 * Connectors are SIMULATED (OTP, IdP, DigiLocker identity, published-binding port) and the whole
 * runtime refuses to start outside LOCAL/CI. Host composition only: no domain logic.
 */
export interface PlatformLabEnv {
  SF_ENVIRONMENT?: string;
  SF_PLATFORM_LAB_DIR?: string;
  DATABASE_URL_CMP004?: string;
  DATABASE_URL_CMP015?: string;
  SF_CMP004_PEPPER?: string;
  SF_OPA_URL?: string;
  SF_OPA_TOKEN?: string;
  /**
   * CMP-004 per-IP limit. Every portal request reaches the host from the BFF's address, so the
   * limit is per portal instance until the BFF forwards the client address through a trusted hop.
   */
  SF_IDENTITY_RATE_LIMIT_MAX?: string;
}

export interface PlatformLab {
  placement: PortalPlacement;
  m02: M02PluginMounts;
  m05: M05PluginMounts;
  readinessChecks: ReadinessCheck[];
  registerSimulators(app: FastifyInstance): Promise<void>;
  close(): Promise<void>;
}

interface Cmp004Module {
  IdentityService: new (opts: Record<string, unknown>) => unknown;
  PgSessionDirectory: new (pool: pg.Pool) => unknown;
  IdentityPrincipalVerifier: new (directory: unknown) => PrincipalPort;
  IdentityContextResolver: new (directory: unknown, cellId: string) => SessionContextPort;
  SimulatedOtpAdapter: new (binding: unknown, pepper: string) => OtpAdapterLike;
  SimulatedIdpAdapter: new (binding: unknown, pepper: string) => unknown;
  SimulatedDigiLockerIdentityAdapter: new (binding: unknown, pepper: string) => unknown;
  simulatedBinding: (params: {
    id: string;
    connector_type: string;
    environment?: string;
    simulator_version: string;
  }) => unknown;
  mintSimulatedIdpAssertion: (pepper: string, claims: Parameters<MintAssertion>[0]) => string;
  outboxAuditRecorder: unknown;
}

const BINDING_IDS = {
  otp: '0d15ba00-0c01-4000-8000-0d15ba000c01',
  idp: '0d15ba00-0c02-4000-8000-0d15ba000c02',
  digilocker: '0d15ba00-0c03-4000-8000-0d15ba000c03',
} as const;

async function loadCmp004(): Promise<Cmp004Module> {
  const specifiers = [
    '@serviceform/cmp-004-identity-access',
    new URL('../../../../services/cmp-004-identity-access/src/index.ts', import.meta.url).href,
  ];
  let last: unknown;
  for (const specifier of specifiers) {
    try {
      return (await import(specifier)) as Cmp004Module;
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

function required(env: PlatformLabEnv, name: keyof PlatformLabEnv): string {
  const value = env[name];
  if (!value) throw new Error(`Invalid configuration for: ${name}`);
  return value;
}

function positiveInt(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000)
    throw new Error(`Invalid configuration for: ${name}`);
  return n;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function poolReadiness(name: string, pool: pg.Pool): ReadinessCheck {
  return {
    name,
    async check() {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
      } finally {
        client.release();
      }
    },
  };
}

export async function buildPlatformLab(env: PlatformLabEnv): Promise<PlatformLab> {
  const environment = env.SF_ENVIRONMENT ?? 'LOCAL';
  assertSimulatorEnvironment(environment);
  const dir = required(env, 'SF_PLATFORM_LAB_DIR');
  const pepper = required(env, 'SF_CMP004_PEPPER');
  if (pepper.length < 32) throw new Error('Invalid configuration for: SF_CMP004_PEPPER');
  const placement = loadPlacement(join(dir, 'placement.citizen.json'), environment);

  const pools = {
    cmp004: new pg.Pool({ connectionString: required(env, 'DATABASE_URL_CMP004'), max: 8 }),
    cmp015: new pg.Pool({ connectionString: required(env, 'DATABASE_URL_CMP015'), max: 8 }),
  };
  const opa = new OpaPdpClient({
    opaUrl: required(env, 'SF_OPA_URL'),
    timeoutMs: 1000,
    ...(env.SF_OPA_TOKEN ? { token: env.SF_OPA_TOKEN } : {}),
  });

  const cmp004 = await loadCmp004();
  const binding = (id: string, connector_type: string, simulator_version: string) =>
    cmp004.simulatedBinding({ id, connector_type, environment, simulator_version });
  const inbox = new SimulatedOtpInbox();
  const directory = new cmp004.PgSessionDirectory(pools.cmp004);
  const verifier = new cmp004.IdentityPrincipalVerifier(directory);
  const sessions = new cmp004.IdentityContextResolver(directory, placement.cell_id);
  const commands = new cmp004.IdentityService({
    pool: pools.cmp004,
    pepper,
    otp: inbox.wrap(
      new cmp004.SimulatedOtpAdapter(binding(BINDING_IDS.otp, 'OTP', 'otp-sim-1'), pepper),
    ),
    idp: new cmp004.SimulatedIdpAdapter(
      binding(BINDING_IDS.idp, 'DEPARTMENT_API', 'idp-sim-1'),
      pepper,
    ),
    digilocker: new cmp004.SimulatedDigiLockerIdentityAdapter(
      binding(BINDING_IDS.digilocker, 'DIGILOCKER', 'dl-sim-1'),
      pepper,
    ),
    authorizer: opa,
    audit: cmp004.outboxAuditRecorder,
    clock: () => new Date(),
    testRunId: `platform-lab-${placement.portal_id}`,
  });

  const bindings = new SimulatedPublishedBindingPort();
  const published = readJson<{ bindings: (PublishedBinding & { tenant_id: string })[] }>(
    join(dir, 'published-bindings.json'),
  );
  const offered = new Set(placement.offerings.map((o) => o.tenant_service_binding_id));
  for (const b of published.bindings) {
    if (b.tenant_id !== placement.tenant_id || !offered.has(b.tenant_service_binding_id)) continue;
    bindings.put(b.tenant_id, {
      tenant_service_binding_id: b.tenant_service_binding_id,
      service_id: b.service_id,
      status: 'PUBLISHED',
      pins: b.pins,
    });
  }
  const applicationCase = new ApplicationCaseService({
    store: new PgCaseStore(pools.cmp015),
    authorizer: opa,
    bindings,
    servicePolicy: new DenyServicePolicyPort(),
    config: { environment: environment as DeploymentEnvironment },
  });

  const officers = readJson<{ officers: LabOfficer[] }>(join(dir, 'officers.json')).officers.filter(
    (o) => o.tenant_id === placement.tenant_id,
  );

  return {
    placement,
    m02: {
      identityAccess: {
        commands,
        verifier,
        resolveContext: sessions as unknown as NonNullable<
          M02PluginMounts['identityAccess']
        >['resolveContext'],
        cellId: placement.cell_id,
        ...(env.SF_IDENTITY_RATE_LIMIT_MAX
          ? {
              rateLimitMax: positiveInt(
                env.SF_IDENTITY_RATE_LIMIT_MAX,
                'SF_IDENTITY_RATE_LIMIT_MAX',
              ),
            }
          : {}),
      },
    },
    m05: {
      applicationCase: {
        service: applicationCase,
        resolveContext: placementContextResolver({ verifier, sessions, placement }),
      },
    },
    readinessChecks: [
      poolReadiness('cmp004-db', pools.cmp004),
      poolReadiness('cmp015-db', pools.cmp015),
    ],
    registerSimulators: (app) =>
      registerLabSimulators(app, {
        environment,
        inbox,
        officers,
        mint: (claims) => cmp004.mintSimulatedIdpAssertion(pepper, claims),
      }),
    async close() {
      await Promise.all([pools.cmp004.end(), pools.cmp015.end()]);
    },
  };
}
