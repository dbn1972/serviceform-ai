import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DeploymentEnvironment, RequestContext } from '@serviceform/contracts';
import type { StorageSecretsPort } from '@serviceform/storage';
import { SimulatedMalwareScanner } from '../../src/adapters/simulated-scanner.js';
import { SimulatedDocumentStorage } from '../../src/adapters/simulated-storage.js';
import {
  buildUploadService,
  registerDocumentUpload,
  type DocumentUploadPluginOptions,
} from '../../src/plugin.js';
import type { UploadService } from '../../src/service/upload-service.js';
import type { MalwareScanPort } from '../../src/ports/scan-port.js';
import type { DocumentStoragePort } from '../../src/ports/storage-port.js';
import type { UploadRepository } from '../../src/repo/types.js';
import { ContractAuthorizer } from './authorizer.js';
import { fixtureResolver, fixtures } from './context-resolver.js';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const CITIZEN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const CITIZEN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const OFFICER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const WORKER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const STORAGE_BINDING = '01301301-3013-4013-8013-013013013013';
export const SCANNER_BINDING = '01301301-3013-4013-8013-013013013014';
export const TRACE = '0af7651916cd43dd8448eb211c80319c';
export const CANARY = `CANARY-T2-${T2}`;

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function pdfBytes(extra = 'synthetic test document'): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${extra}\n%%EOF\n`);
}

export function pngBytes(): Uint8Array {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
}

export function ctx(
  partial: Partial<RequestContext> & Pick<RequestContext, 'tenant_id' | 'actor'>,
): RequestContext {
  return {
    cell_id: 'cell-01',
    roles: partial.actor.type === 'CITIZEN' ? ['APPLICANT'] : ['SERVICE_CHECKER'],
    jurisdiction_ids: [],
    auth_assurance: 'OTP',
    correlation_id: randomUUID(),
    trace_id: TRACE,
    ...partial,
  };
}

export class TestSecrets implements StorageSecretsPort {
  fail = false;
  async getHmacKey(): Promise<Uint8Array> {
    if (this.fail) throw new Error('secret unavailable');
    return new TextEncoder().encode('test-only-hmac-key-0123456789abcdef');
  }
}

export class MutableClock {
  constructor(public now = Date.parse('2026-10-04T12:00:00.000Z')) {}
  readonly fn = (): Date => new Date(this.now);
  advance(seconds: number): void {
    this.now += seconds * 1000;
  }
}

type Fault = 'issue' | 'inspect' | 'release' | 'discard' | 'download' | 'scan';

/** Wraps real SIMULATED adapters with fault injection and an in-transaction call probe. */
export class Probe {
  faults = new Set<Fault>();
  calls: { op: Fault; inTx: boolean }[] = [];
  repo: UploadRepository | undefined;

  record(op: Fault): void {
    this.calls.push({ op, inTx: this.repo?.inTransaction() ?? false });
    if (this.faults.has(op)) throw new Error(`${op} unavailable`);
  }

  storage(inner: DocumentStoragePort): DocumentStoragePort {
    return {
      mode: inner.mode,
      connectorBindingId: inner.connectorBindingId,
      ...(inner.simulation ? { simulation: inner.simulation } : {}),
      issueUploadTarget: async (i) => {
        this.record('issue');
        return inner.issueUploadTarget(i);
      },
      inspectObject: async (i) => {
        this.record('inspect');
        return inner.inspectObject(i);
      },
      releaseFromQuarantine: async (i) => {
        this.record('release');
        return inner.releaseFromQuarantine(i);
      },
      discard: async (i) => {
        this.record('discard');
        return inner.discard(i);
      },
      issueDownloadAccess: async (i) => {
        this.record('download');
        return inner.issueDownloadAccess(i);
      },
    };
  }

  scanner(inner: MalwareScanPort): MalwareScanPort {
    return {
      mode: inner.mode,
      connectorBindingId: inner.connectorBindingId,
      ...(inner.simulation ? { simulation: inner.simulation } : {}),
      scan: async (i) => {
        this.record('scan');
        return inner.scan(i);
      },
    };
  }
}

export interface Harness {
  app: FastifyInstance;
  service: UploadService;
  storage: SimulatedDocumentStorage;
  scanner: SimulatedMalwareScanner;
  authorizer: ContractAuthorizer;
  probe: Probe;
  clock: MutableClock;
  secrets: TestSecrets;
}

export async function buildHarness(
  repo: UploadRepository,
  opts: { environment?: DeploymentEnvironment } = {},
): Promise<Harness> {
  const environment = opts.environment ?? 'CI';
  const secrets = new TestSecrets();
  const storage = new SimulatedDocumentStorage({
    environment,
    testRunId: 'cmp-013-test',
    connectorBindingId: STORAGE_BINDING,
    secrets,
    secretName: 'local/upload-presign',
  });
  const scanner = new SimulatedMalwareScanner({
    environment,
    testRunId: 'cmp-013-test',
    connectorBindingId: SCANNER_BINDING,
    read: (tenantId, key) => storage.readForScan(tenantId, key),
  });
  const probe = new Probe();
  probe.repo = repo;
  const authorizer = new ContractAuthorizer();
  const clock = new MutableClock();
  fixtures.clear();
  const app = Fastify({
    logger: false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  const options: DocumentUploadPluginOptions = {
    environment,
    repository: repo,
    resolveContext: fixtureResolver,
    authorizer,
    storage: probe.storage(storage),
    scanner: probe.scanner(scanner),
    workerActorId: WORKER,
    clock: clock.fn,
  };
  await registerDocumentUpload(app, options);
  const service = buildUploadService(options);
  fixtures.set('t1-citizen', ctx({ tenant_id: T1, actor: { type: 'CITIZEN', id: CITIZEN_A } }));
  fixtures.set('t1-citizen-b', ctx({ tenant_id: T1, actor: { type: 'CITIZEN', id: CITIZEN_B } }));
  fixtures.set(
    't1-officer',
    ctx({ tenant_id: T1, actor: { type: 'OFFICER', id: OFFICER }, auth_assurance: 'MFA' }),
  );
  fixtures.set('t2-citizen', ctx({ tenant_id: T2, actor: { type: 'CITIZEN', id: CITIZEN_A } }));
  fixtures.set(
    't2-officer',
    ctx({ tenant_id: T2, actor: { type: 'OFFICER', id: OFFICER }, auth_assurance: 'MFA' }),
  );
  fixtures.set('no-tenant', ctx({ tenant_id: null, actor: { type: 'CITIZEN', id: CITIZEN_A } }));
  return { app, service, storage, scanner, authorizer, probe, clock, secrets };
}

export function auth(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...extra };
}

export function idem(label: string): Record<string, string> {
  return { 'idempotency-key': `idem-${label}-${randomUUID().slice(0, 8)}` };
}

export const PDF_POLICY = {
  policy_code: 'IDENTITY_PROOF',
  allowed_content_types: ['application/pdf', 'image/png'],
  max_bytes: 4096,
  session_ttl_seconds: 900,
  max_scan_attempts: 2,
  classification: 'CITIZEN_PRIVATE',
} as const;
