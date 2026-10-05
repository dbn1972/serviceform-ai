import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DeploymentEnvironment, RequestContext } from '@serviceform/contracts';
import { SimulatedOcrAdapter, type SimulatedDocument } from '../../src/adapters/simulated-ocr.js';
import { registerDocumentIntelligence } from '../../src/plugin.js';
import type { OcrPort } from '../../src/ports/ocr-port.js';
import type {
  SourceAclPort,
  SourceDocument,
  SourceDocumentPort,
} from '../../src/ports/source-port.js';
import { ContractAuthorizer } from './authorizer.js';
import { fixtureResolver, fixtures } from './context-resolver.js';
import { FakeGateway } from './fake-gateway.js';
import { MemoryDocIntelRepository } from './memory-repo.js';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const OFFICER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const DOC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const DOC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const OCR_BINDING = '01401401-4014-4014-8014-014014014014';
export const TRACE = '0af7651916cd43dd8448eb211c80319c';
export const CANARY = `CANARY-T2-${T2}`;
export const PII_EMAIL = 'citizen@example.test';
export const PII_PHONE = '9876543210';
export const SHA_A = createHash('sha256').update('doc-a').digest('hex');
export const SHA_B = createHash('sha256').update('doc-b').digest('hex');

export function ctx(tenant: string): RequestContext {
  return {
    tenant_id: tenant,
    cell_id: 'cell-01',
    actor: { type: 'OFFICER', id: OFFICER },
    roles: ['SERVICE_CHECKER'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: randomUUID(),
    trace_id: TRACE,
  };
}

export class MemorySources implements SourceDocumentPort {
  docs = new Map<string, SourceDocument>();

  put(doc: SourceDocument): void {
    this.docs.set(`${doc.tenantId}:${doc.documentId}`, doc);
  }

  async resolve(input: {
    tenantId: string;
    documentId: string;
    checksumSha256: string;
  }): Promise<SourceDocument | null> {
    const row = this.docs.get(`${input.tenantId}:${input.documentId}`);
    if (!row || row.checksumSha256 !== input.checksumSha256) return null;
    return row;
  }
}

export class MemorySourceAcl implements SourceAclPort {
  grants = new Set<string>();
  allow(tenantId: string, sourceId: string): void {
    this.grants.add(`${tenantId}:${sourceId}`);
  }
  async canRead(input: { tenantId: string; sourceId: string }): Promise<boolean> {
    return this.grants.has(`${input.tenantId}:${input.sourceId}`);
  }
}

export const POLICY = {
  policy_code: 'EXTRACT_GENERIC',
  allowed_content_types: ['application/pdf', 'text/plain'],
  min_confidence: 0.8,
  max_excerpt_chars: 2000,
  gateway_policy_id: 'extract-fields',
  gateway_policy_version: 1,
  latency_budget_ms: 4000,
};

export interface Harness {
  app: FastifyInstance;
  repo: MemoryDocIntelRepository;
  authorizer: ContractAuthorizer;
  sources: MemorySources;
  acl: MemorySourceAcl;
  ocr: SimulatedOcrAdapter;
  gateway: FakeGateway;
  call: (
    tenant: string,
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
    key?: string,
  ) => Promise<{ status: number; body: Record<string, unknown> }>;
}

export async function buildHarness(
  environment: DeploymentEnvironment = 'CI',
  extraDocs: SimulatedDocument[] = [],
): Promise<Harness> {
  fixtures.clear();
  const repo = new MemoryDocIntelRepository();
  const authorizer = new ContractAuthorizer();
  const sources = new MemorySources();
  const acl = new MemorySourceAcl();
  const docs = new Map<string, SimulatedDocument>();
  const inner = new SimulatedOcrAdapter(OCR_BINDING, docs, 'CI');
  const defaultText = `[class:ADDRESS_PROOF] locality line ${PII_EMAIL} ${PII_PHONE}`;
  inner.register({
    tenantId: T1,
    documentId: DOC_A,
    checksumSha256: SHA_A,
    contentType: 'application/pdf',
    text: defaultText,
    scenario: 'success',
  });
  inner.register({
    tenantId: T2,
    documentId: DOC_B,
    checksumSha256: SHA_B,
    contentType: 'application/pdf',
    text: CANARY,
    scenario: 'success',
  });
  for (const d of extraDocs) inner.register(d);
  const ocr: OcrPort = {
    mode: inner.mode,
    connectorBindingId: inner.connectorBindingId,
    simulation: inner.simulation,
    recognize: async (input) => {
      if (repo.inTransaction()) throw new Error('ocr called inside transaction');
      return inner.recognize(input);
    },
  };
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
  const gateway = new FakeGateway();
  gateway.inTxProbe = () => repo.inTransaction();
  const app = Fastify({ logger: false });
  await registerDocumentIntelligence(app, {
    environment,
    repository: repo,
    resolveContext: fixtureResolver,
    authorizer,
    sources,
    sourceAcl: acl,
    ocr,
    gateway,
    clock: () => new Date('2026-10-04T12:00:00.000Z'),
  });
  let n = 0;
  const call: Harness['call'] = async (tenant, method, url, body, key) => {
    const token = `tok-${tenant}`;
    fixtures.set(token, ctx(tenant));
    n += 1;
    const res = await app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        ...(method === 'POST' ? { 'idempotency-key': key ?? `key-${n}-${randomUUID()}` } : {}),
      },
      ...(body === undefined ? {} : { payload: body as object }),
    });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  };
  return { app, repo, authorizer, sources, acl, ocr: inner, gateway, call };
}

export async function seedPolicy(h: Harness, tenant = T1): Promise<void> {
  const res = await h.call(tenant, 'POST', '/v1/extraction-policies', POLICY);
  if (res.status !== 201) throw new Error(`seedPolicy ${res.status} ${JSON.stringify(res.body)}`);
}

export const JOB_BODY = {
  policy_code: 'EXTRACT_GENERIC',
  source_document_id: DOC_A,
  source_checksum_sha256: SHA_A,
  purpose: 'assistive field extraction',
  data_classification: 'PERSONAL',
};
