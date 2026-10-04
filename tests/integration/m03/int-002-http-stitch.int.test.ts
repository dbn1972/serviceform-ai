import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequestContext } from '@serviceform/contracts';
import { registerMetadata } from '../../../services/cmp-033-metadata/src/plugin.js';
import { loadConfig as load033 } from '../../../services/cmp-033-metadata/src/config.js';
import { ContractAuthorizer as Auth033 } from '../../../services/cmp-033-metadata/test/doubles/authorizer.js';
import { registerMakerChecker } from '../../../services/cmp-051-maker-checker/src/plugin.js';
import { loadConfig as load051 } from '../../../services/cmp-051-maker-checker/src/config.js';
import { ContractAuthorizer as Auth051 } from '../../../services/cmp-051-maker-checker/test/doubles/authorizer.js';
import { registerVersioning } from '../../../services/cmp-052-versioning/src/plugin.js';
import { loadConfig as load052 } from '../../../services/cmp-052-versioning/src/config.js';
import { SimulatedApprovalPort } from '../../../services/cmp-052-versioning/src/ports/approval.js';
import { ContractAuthorizer as Auth052 } from '../../../services/cmp-052-versioning/test/doubles/authorizer.js';
import { validPins } from '../../../services/cmp-052-versioning/test/fixtures/pins.js';
import { createInt002Client } from '../../../services/cmp-050-studio-portal/src/int002-client.js';
import type { PlatformTransport } from '../../../services/cmp-050-studio-portal/src/proxy.js';
import {
  ACTOR,
  CHECKER,
  MAKER,
  T1,
  T2,
  TRACE,
  createLogin,
  dropRoles,
  migrateUp,
  rolePassword,
  runtimePool,
  withAdmin,
} from './pg-harness.js';

const ROLES = ['sf_m03int_033', 'sf_m03int_051', 'sf_m03int_052'] as const;

function ctx(tenantId: string, actorId: string, roles: string[]): RequestContext {
  return {
    tenant_id: tenantId,
    cell_id: 'cell-01',
    actor: { type: 'OFFICER', id: actorId },
    roles,
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: randomUUID(),
    trace_id: TRACE,
  };
}

describe('INT-002 HTTP stitch (CMP-050 client → 033/051/052 LOGIN plugins)', () => {
  const sessions = new Map<string, RequestContext>();
  const password = rolePassword();
  let pools: ReturnType<typeof runtimePool>[] = [];
  let app: ReturnType<typeof Fastify> | undefined;

  beforeAll(async () => {
    await withAdmin(async (c) => {
      await dropRoles(c, ROLES);
    });
    migrateUp();
    await withAdmin(async (c) => {
      await createLogin(c, 'sf_m03int_033', 'sf_cmp033_rw', password);
      await createLogin(c, 'sf_m03int_051', 'sf_cmp051_rw', password);
      await createLogin(c, 'sf_m03int_052', 'sf_cmp052_rw', password);
    });
    const p033 = runtimePool('sf_m03int_033', password);
    const p051 = runtimePool('sf_m03int_051', password);
    const p052 = runtimePool('sf_m03int_052', password);
    pools = [p033, p051, p052];

    const resolveContext = async (request: { headers: { authorization?: string } }) => {
      const auth = request.headers.authorization ?? '';
      if (!auth.startsWith('Bearer ')) return null;
      return sessions.get(auth.slice('Bearer '.length)) ?? null;
    };

    const cfg033 = load033({ SF_ENVIRONMENT: 'LOCAL', SF_METADATA_SCHEMA_MODE: 'SIMULATED' });
    const cfg051 = load051({ SF_ENVIRONMENT: 'LOCAL', SF_CMP051_METADATA_MODE: 'SIMULATED' });
    const cfg052 = load052({ SF_ENVIRONMENT: 'LOCAL', SF_CMP052_APPROVAL_MODE: 'SIMULATED' });

    app = Fastify({
      logger: false,
      ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    });
    const clock = () => new Date('2026-10-04T12:00:00.000Z');
    await registerMetadata(app, {
      prefix: '/v1',
      pool: p033,
      resolveContext,
      authorizer: new Auth033(),
      config: cfg033,
      clock,
    });
    await registerMakerChecker(app, {
      prefix: '/v1',
      pool: p051,
      resolveContext,
      authorizer: new Auth051(),
      config: cfg051,
      clock,
    });
    await registerVersioning(app, {
      prefix: '/v1',
      pool: p052,
      resolveContext,
      authorizer: new Auth052(),
      approval: new SimulatedApprovalPort(cfg052, true),
      config: cfg052,
      clock,
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await Promise.all(pools.map((p) => p.end()));
  });

  it('validate → binding → checker approve → publish; T2 cannot read T1', async () => {
    sessions.set('maker', ctx(T1, MAKER, ['SERVICE_DESIGNER']));
    sessions.set('checker', ctx(T1, CHECKER, ['SERVICE_CHECKER']));
    sessions.set('t2', ctx(T2, ACTOR, ['SERVICE_DESIGNER']));

    const injectAs = (token: string): PlatformTransport => ({
      async send(req) {
        const headers: Record<string, string> = { authorization: `Bearer ${token}` };
        if (req.idempotencyKey) headers['idempotency-key'] = req.idempotencyKey;
        const injected = await app!.inject({
          method: req.method,
          url: req.path,
          headers,
          payload: req.body as never,
        });
        let body: unknown = {};
        try {
          body = injected.json();
        } catch {
          body = injected.body;
        }
        return { status: injected.statusCode, body };
      },
    });

    const makerClient = createInt002Client(injectAs('maker'));

    const created = await makerClient.createMetadataDocument({
      kind: 'SERVICE',
      document_key: 'generic.service',
      payload: { code: 'generic_service', title: 'Generic configurable service' },
    });
    expect(created.status).toBe(201);
    const docId = (created.body as { document_id: string }).document_id;

    const validated = await makerClient.validateMetadataDocument(docId);
    expect(validated.status).toBe(200);
    expect((validated.body as { status: string }).status).toBe('VALIDATED');
    expect(
      (validated.body as { simulation?: { simulation: boolean } }).simulation?.simulation,
    ).toBe(true);

    const binding = await makerClient.createTenantServiceBinding({
      binding_key: 'generic.binding',
      offering_ref: 'generic.offering',
      metadata_bundle_ref: 'generic.bundle',
      pins: validPins(),
    });
    expect(binding.status).toBe(201);
    const bindingId = (binding.body as { binding_id: string }).binding_id;
    const hash = (binding.body as { artifact_hash: string }).artifact_hash;

    const pub = await makerClient.createPublicationRequest({
      subject_id: bindingId,
      proposed_hash: hash,
    });
    expect(pub.status).toBe(201);
    const requestId = (pub.body as { request_id: string }).request_id;

    expect((await makerClient.submitPublicationRequest(requestId)).status).toBe(200);

    const selfApprove = await app!.inject({
      method: 'POST',
      url: `/v1/publication-requests/${requestId}/approve`,
      headers: { authorization: 'Bearer maker', 'idempotency-key': randomUUID() },
      payload: { reason: 'maker-self-approve' },
    });
    expect(selfApprove.statusCode).toBe(403);

    const approved = await app!.inject({
      method: 'POST',
      url: `/v1/publication-requests/${requestId}/approve`,
      headers: { authorization: 'Bearer checker', 'idempotency-key': randomUUID() },
      payload: { reason: 'checker-approval' },
    });
    expect(approved.statusCode).toBe(200);
    expect((approved.json() as { status: string }).status).toBe('APPROVED');

    const published = await makerClient.publishTenantServiceBinding(bindingId);
    expect(published.status).toBe(200);
    expect((published.body as { status: string }).status).toBe('PUBLISHED');

    const t2 = await app!.inject({
      method: 'GET',
      url: `/v1/tenant-service-bindings/${bindingId}`,
      headers: { authorization: 'Bearer t2' },
    });
    expect([403, 404]).toContain(t2.statusCode);
    if (t2.statusCode === 200) {
      throw new Error('CROSS_TENANT_LEAKAGE');
    }
  });
});
