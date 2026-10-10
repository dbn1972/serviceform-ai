import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ActorType, RequestContext } from '@serviceform/contracts';
import { registerRecommendation } from '../../src/plugin.js';
import type { CatalogueCandidate, CataloguePort } from '../../src/ports/catalogue-port.js';
import type { ConsentCheck, ConsentPort } from '../../src/ports/consent-port.js';
import type { ProfileSignalPort } from '../../src/ports/profile-port.js';
import { ContractAuthorizer } from './authorizer.js';
import { fixtureResolver, fixtures } from './context-resolver.js';
import { FakeGateway } from './fake-gateway.js';
import { MemoryRecommendationRepository } from './memory-repo.js';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const CITIZEN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const CITIZEN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const OFFICER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const SVC_1 = '51111111-1111-4111-8111-111111111111';
export const SVC_2 = '52222222-2222-4222-8222-222222222222';
export const SVC_RETIRED = '53333333-3333-4333-8333-333333333333';
export const SVC_T2 = '54444444-4444-4444-8444-444444444444';
export const APP_ID = '33333333-3333-4333-8333-333333333333';
export const TRACE = '0af7651916cd43dd8448eb211c80319c';
export const CANARY = `CANARY-T2-${T2}`;

export function ctx(
  tenant: string,
  actor: { type: ActorType; id: string } = { type: 'CITIZEN', id: CITIZEN_A },
): RequestContext {
  return {
    tenant_id: tenant,
    cell_id: 'cell-01',
    actor,
    roles: actor.type === 'CITIZEN' ? ['CITIZEN'] : ['SERVICE_CHECKER'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: randomUUID(),
    trace_id: TRACE,
  };
}

export class MemoryCatalogue implements CataloguePort {
  rows: CatalogueCandidate[] = [];
  calls = 0;

  put(row: CatalogueCandidate): void {
    this.rows.push(row);
  }

  async resolve(input: { tenantId: string; serviceIds: string[] }): Promise<CatalogueCandidate[]> {
    this.calls += 1;
    return this.rows.filter(
      (r) => r.tenantId === input.tenantId && input.serviceIds.includes(r.serviceId),
    );
  }

  async listPublished(input: { tenantId: string; limit: number }): Promise<CatalogueCandidate[]> {
    this.calls += 1;
    return this.rows
      .filter((r) => r.tenantId === input.tenantId && r.status === 'PUBLISHED')
      .slice(0, input.limit);
  }
}

export class MemoryConsent implements ConsentPort {
  grants = new Set<string>();
  throws = false;
  calls: { tenantId: string; subjectId: string; purposeCode: string }[] = [];

  grant(tenantId: string, subjectId: string, purposeCode: string): void {
    this.grants.add(`${tenantId}:${subjectId}:${purposeCode}`);
  }

  async check(input: {
    tenantId: string;
    subjectId: string;
    purposeCode: string;
  }): Promise<ConsentCheck> {
    this.calls.push(input);
    if (this.throws) throw new Error('consent-down');
    const granted = this.grants.has(`${input.tenantId}:${input.subjectId}:${input.purposeCode}`);
    return granted ? { granted, consentRef: 'consent-ref-1' } : { granted };
  }
}

export class MemoryProfile implements ProfileSignalPort {
  signalList: string[] = ['AGE_BAND_ADULT', 'NOT_ALLOWED_SIGNAL'];
  throws = false;
  calls = 0;

  async signals(): Promise<string[]> {
    this.calls += 1;
    if (this.throws) throw new Error('profile-down');
    return this.signalList;
  }
}

export const POLICY = {
  policy_code: 'DISCOVERY_ASSIST',
  consent_purpose_code: 'SERVICE_DISCOVERY',
  gateway_policy_id: 'recommend-services',
  gateway_policy_version: 1,
  model_route_ref: 'cmp039.route.discovery.assist.v1',
  allowed_reason_codes: ['CATEGORY_MATCH', 'JURISDICTION_MATCH', 'POPULAR_FOR_PROFILE'],
  allowed_signal_codes: ['AGE_BAND_ADULT', 'HOUSEHOLD_SIZE_BAND'],
  max_candidates: 10,
  max_results: 3,
  latency_budget_ms: 4000,
};

export interface Harness {
  app: FastifyInstance;
  repo: MemoryRecommendationRepository;
  authorizer: ContractAuthorizer;
  catalogue: MemoryCatalogue;
  consent: MemoryConsent;
  profile: MemoryProfile;
  gateway: FakeGateway;
  call: (
    tenant: string,
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
    options?: { key?: string; actor?: { type: ActorType; id: string } },
  ) => Promise<{ status: number; body: Record<string, unknown> }>;
}

export function seedCatalogue(c: MemoryCatalogue): void {
  c.put({
    tenantId: T1,
    serviceId: SVC_1,
    serviceCode: 'SERVICE_ONE',
    categoryCode: 'CATEGORY_A',
    publishedVersionRef: 'v1',
    status: 'PUBLISHED',
  });
  c.put({
    tenantId: T1,
    serviceId: SVC_2,
    serviceCode: 'SERVICE_TWO',
    categoryCode: 'CATEGORY_B',
    publishedVersionRef: 'v3',
    status: 'PUBLISHED',
  });
  c.put({
    tenantId: T1,
    serviceId: SVC_RETIRED,
    serviceCode: 'SERVICE_OLD',
    categoryCode: null,
    publishedVersionRef: 'v2',
    status: 'RETIRED',
  });
  c.put({
    tenantId: T2,
    serviceId: SVC_T2,
    serviceCode: CANARY.replaceAll('-', '_').toUpperCase(),
    categoryCode: null,
    publishedVersionRef: 'v1',
    status: 'PUBLISHED',
  });
}

export async function buildHarness(): Promise<Harness> {
  fixtures.clear();
  const repo = new MemoryRecommendationRepository();
  const authorizer = new ContractAuthorizer();
  const catalogue = new MemoryCatalogue();
  seedCatalogue(catalogue);
  const consent = new MemoryConsent();
  consent.grant(T1, CITIZEN_A, 'SERVICE_DISCOVERY');
  consent.grant(T1, CITIZEN_B, 'SERVICE_DISCOVERY');
  consent.grant(T2, CITIZEN_A, 'SERVICE_DISCOVERY');
  const profile = new MemoryProfile();
  const gateway = new FakeGateway();
  gateway.inTxProbe = () => repo.inTransaction();
  const app = Fastify({ logger: false });
  await registerRecommendation(app, {
    repository: repo,
    resolveContext: fixtureResolver,
    authorizer,
    catalogue,
    consent,
    profile,
    gateway,
    clock: () => new Date('2026-10-10T12:00:00.000Z'),
  });
  let n = 0;
  const call: Harness['call'] = async (tenant, method, url, body, options = {}) => {
    const actor = options.actor ?? { type: 'CITIZEN' as const, id: CITIZEN_A };
    const token = `tok-${tenant}-${actor.id}`;
    fixtures.set(token, ctx(tenant, actor));
    n += 1;
    const res = await app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        ...(method === 'POST' && !url.endsWith('/disposition')
          ? { 'idempotency-key': options.key ?? `key-${n}-${randomUUID()}` }
          : {}),
      },
      ...(body === undefined ? {} : { payload: body as object }),
    });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  };
  return { app, repo, authorizer, catalogue, consent, profile, gateway, call };
}

export async function seedPolicy(h: Harness, tenant = T1, overrides: object = {}): Promise<void> {
  const res = await h.call(
    tenant,
    'POST',
    '/v1/recommendation-policies',
    { ...POLICY, ...overrides },
    { actor: { type: 'OFFICER', id: OFFICER } },
  );
  if (res.status !== 201) throw new Error(`seedPolicy ${res.status} ${JSON.stringify(res.body)}`);
}

export const REC_BODY = {
  policy_code: 'DISCOVERY_ASSIST',
  candidate_service_ids: [SVC_1, SVC_2],
  context_signals: ['AGE_BAND_ADULT'],
};
