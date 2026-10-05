import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SimulatedOcrAdapter } from '../../src/adapters/simulated-ocr.js';
import { registerDocumentIntelligence } from '../../src/plugin.js';
import { PgDocIntelRepository } from '../../src/repo/pg.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures } from '../doubles/context-resolver.js';
import { FakeGateway } from '../doubles/fake-gateway.js';
import {
  DOC_A,
  DOC_B,
  JOB_BODY,
  OCR_BINDING,
  POLICY,
  SHA_A,
  SHA_B,
  T1,
  T2,
  ctx,
  MemorySourceAcl,
  MemorySources,
  PII_EMAIL,
  PII_PHONE,
} from '../doubles/fixtures.js';
import { closeHarness, setupHarness, type Harness } from './helpers.js';

describe('CMP-014 API over PostgreSQL FORCE RLS', () => {
  let db: Harness;

  beforeAll(async () => {
    db = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(db);
  });

  it('persists assistive jobs per tenant and hides cross-tenant rows', async () => {
    const repo = new PgDocIntelRepository(db.rt);
    fixtures.clear();
    const sources = new MemorySources();
    const acl = new MemorySourceAcl();
    const inner = new SimulatedOcrAdapter(OCR_BINDING, new Map(), 'CI');
    inner.register({
      tenantId: T1,
      documentId: DOC_A,
      checksumSha256: SHA_A,
      contentType: 'application/pdf',
      text: `[class:ADDRESS_PROOF] ${PII_EMAIL} ${PII_PHONE}`,
      scenario: 'success',
    });
    inner.register({
      tenantId: T2,
      documentId: DOC_B,
      checksumSha256: SHA_B,
      contentType: 'application/pdf',
      text: 't2',
      scenario: 'success',
    });
    sources.put({
      documentId: DOC_A,
      tenantId: T1,
      checksumSha256: SHA_A,
      contentType: 'application/pdf',
      status: 'AVAILABLE',
    });
    sources.put({
      documentId: DOC_B,
      tenantId: T2,
      checksumSha256: SHA_B,
      contentType: 'application/pdf',
      status: 'AVAILABLE',
    });
    acl.allow(T1, DOC_A);
    acl.allow(T2, DOC_B);
    const app = Fastify({ logger: false });
    await registerDocumentIntelligence(app, {
      environment: 'CI',
      repository: repo,
      resolveContext: fixtureResolver,
      authorizer: new ContractAuthorizer(),
      sources,
      sourceAcl: acl,
      ocr: inner,
      gateway: new FakeGateway(),
    });
    const call = async (tenant: string, method: 'GET' | 'POST', url: string, body?: unknown) => {
      const token = `tok-${tenant}`;
      fixtures.set(token, ctx(tenant));
      const res = await app.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${token}`,
          ...(method === 'POST' ? { 'idempotency-key': `k-${randomUUID()}` } : {}),
        },
        ...(body === undefined ? {} : { payload: body as object }),
      });
      return { status: res.statusCode, body: res.json() as Record<string, unknown> };
    };
    expect((await call(T1, 'POST', '/v1/extraction-policies', POLICY)).status).toBe(201);
    const created = await call(T1, 'POST', '/v1/intelligence-jobs', JOB_BODY);
    expect(created.status).toBe(201);
    const processed = await call(
      T1,
      'POST',
      `/v1/intelligence-jobs/${created.body['job_id']}/process`,
    );
    expect(processed.status).toBe(200);
    expect(processed.body['advisory_only']).toBe(true);
    expect(processed.body['statutory_decision']).toBe(false);
    const leak = await call(T2, 'GET', `/v1/intelligence-jobs/${created.body['job_id']}`);
    expect(leak.status).toBe(404);
    await app.close();
  });
});
