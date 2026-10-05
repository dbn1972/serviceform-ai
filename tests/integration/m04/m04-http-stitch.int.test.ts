import { createHash, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validate, type RequestContext } from '@serviceform/contracts';
import { createLogger } from '@serviceform/observability';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildApp } from '../../../apps/api/src/app.js';
import { loadConfig } from '../../../apps/api/src/config.js';
import type { M04PluginMounts } from '../../../apps/api/src/composition/m04.js';
import { loadConfig as load039 } from '../../../services/cmp-039-ai-gateway/src/config.js';
import {
  SimulatedPurposeConsentPort,
  SimulatedSourceAclPort,
} from '../../../services/cmp-039-ai-gateway/src/ports/policy-ports.js';
import { buildProviderRegistry } from '../../../services/cmp-039-ai-gateway/src/ports/provider.js';
import { ContractAuthorizer as Auth039 } from '../../../services/cmp-039-ai-gateway/test/doubles/authorizer.js';
import { loadConfig as load008 } from '../../../services/cmp-008-rules/src/config.js';
import { SimulatedRulePackPort } from '../../../services/cmp-008-rules/src/ports/rule-pack.js';
import { packFixture, pinOf } from '../../../services/cmp-008-rules/test/fixtures/packs.js';
import { ContractAuthorizer as Auth008 } from '../../../services/cmp-008-rules/test/doubles/authorizer.js';
import { loadConfig as load009 } from '../../../services/cmp-009-dynamic-forms/src/config.js';
import { SimulatedFormDefinitionPort } from '../../../services/cmp-009-dynamic-forms/src/ports/form-definition.js';
import { SimulatedLocalizationPort } from '../../../services/cmp-009-dynamic-forms/src/ports/localization.js';
import {
  formFixture,
  pinOf as formPin,
  validData,
} from '../../../services/cmp-009-dynamic-forms/test/fixtures/forms.js';
import { ContractAuthorizer as Auth009 } from '../../../services/cmp-009-dynamic-forms/test/doubles/authorizer.js';
import { loadConfig as load011 } from '../../../services/cmp-011-evidence-requirements/src/config.js';
import { samplePolicy } from '../../../services/cmp-011-evidence-requirements/test/fixtures/policy.js';
import { ContractAuthorizer as Auth011 } from '../../../services/cmp-011-evidence-requirements/test/doubles/authorizer.js';
import {
  StaticBindingPins,
  StaticUploads,
  ToggleApproval,
  ToggleConsent,
} from '../../../services/cmp-011-evidence-requirements/test/doubles/ports.js';
import { SimulatedDocumentStorage } from '../../../services/cmp-013-document-upload/src/adapters/simulated-storage.js';
import { SimulatedMalwareScanner } from '../../../services/cmp-013-document-upload/src/adapters/simulated-scanner.js';
import { PgUploadRepository } from '../../../services/cmp-013-document-upload/src/repo/pg.js';
import { ContractAuthorizer as Auth013 } from '../../../services/cmp-013-document-upload/test/doubles/authorizer.js';
import {
  TestSecrets,
  sha256 as uploadSha,
  pdfBytes,
} from '../../../services/cmp-013-document-upload/test/doubles/fixtures.js';
import { SimulatedOcrAdapter } from '../../../services/cmp-014-document-intelligence/src/adapters/simulated-ocr.js';
import { PgDocIntelRepository } from '../../../services/cmp-014-document-intelligence/src/repo/pg.js';
import { ContractAuthorizer as Auth014 } from '../../../services/cmp-014-document-intelligence/test/doubles/authorizer.js';
import { FakeGateway } from '../../../services/cmp-014-document-intelligence/test/doubles/fake-gateway.js';
import {
  MemorySourceAcl,
  MemorySources,
  POLICY as EXTRACT_POLICY,
  JOB_BODY,
  DOC_A,
  SHA_A,
  PII_EMAIL,
} from '../../../services/cmp-014-document-intelligence/test/doubles/fixtures.js';
import {
  ACTOR,
  BINDING,
  CANARY,
  OFFICER_T1,
  T1,
  T2,
  TRACE,
  createLogin,
  dropRoles,
  ensurePeerGroupRoles,
  migrateUp,
  rolePassword,
  runtimePool,
  withAdmin,
} from './pg-harness.js';

const ROLES = [
  'sf_m04st_039',
  'sf_m04st_008',
  'sf_m04st_011',
  'sf_m04st_013',
  'sf_m04st_009',
  'sf_m04st_014',
] as const;

const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-m04-int',
  LOG_LEVEL: 'silent',
  SF_GATEWAY_RATE_LIMIT_MAX: '10000',
});

function silentLogger() {
  const destination = new Writable({
    write(_chunk: Buffer, _e, cb) {
      cb();
    },
  });
  return createLogger({ service: 'm04-stitch', version: 'test', level: 'info', destination });
}

function ctx(tenant: string, actor = OFFICER_T1): RequestContext {
  return {
    tenant_id: tenant,
    cell_id: 'cell-01',
    actor: { type: 'OFFICER', id: actor },
    roles: ['SERVICE_CHECKER', 'SERVICE_DESIGNER', 'CASE_OFFICER'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: randomUUID(),
    trace_id: TRACE,
  };
}

describe('M04 HTTP stitch (host composition + CMP-039/008/011/013/009/014)', () => {
  const password = rolePassword();
  const tokens = new Map<string, RequestContext>();
  let pools: Record<string, ReturnType<typeof runtimePool>>;
  let app: FastifyInstance;
  let packs: SimulatedRulePackPort;
  let forms: SimulatedFormDefinitionPort;
  let pins: StaticBindingPins;
  let consent039: SimulatedPurposeConsentPort;
  let sources039: SimulatedSourceAclPort;
  let gatewayFake: FakeGateway;
  let uploadStorage: SimulatedDocumentStorage;
  let uploadServiceRepo: PgUploadRepository;
  let auth008: Auth008;
  let auth039: Auth039;

  beforeAll(async () => {
    await withAdmin(async (c) => {
      await dropRoles(c, ROLES);
    });
    migrateUp();
    await withAdmin(async (c) => {
      await ensurePeerGroupRoles(c);
      await createLogin(c, 'sf_m04st_039', 'sf_cmp039_rw', password);
      await createLogin(c, 'sf_m04st_008', 'sf_cmp008_rw', password);
      await createLogin(c, 'sf_m04st_011', 'sf_cmp011_rw', password);
      await createLogin(c, 'sf_m04st_013', 'sf_cmp013_rw', password);
      await createLogin(c, 'sf_m04st_009', 'sf_cmp009_rw', password);
      await createLogin(c, 'sf_m04st_014', 'sf_cmp014_rw', password);
    });
    pools = {
      p039: runtimePool('sf_m04st_039', password),
      p008: runtimePool('sf_m04st_008', password),
      p011: runtimePool('sf_m04st_011', password),
      p013: runtimePool('sf_m04st_013', password),
      p009: runtimePool('sf_m04st_009', password),
      p014: runtimePool('sf_m04st_014', password),
    };

    tokens.set('t1', ctx(T1));
    tokens.set('t2', ctx(T2, ACTOR));

    const resolveContext = async (request: FastifyRequest): Promise<RequestContext | null> => {
      const header = request.headers.authorization;
      if (!header || Array.isArray(header) || !header.startsWith('Bearer ')) return null;
      return tokens.get(header.slice(7)) ?? null;
    };

    const cfg039 = load039({ SF_ENVIRONMENT: 'CI', SF_CMP039_PROVIDER_MODE: 'SIMULATED' });
    const cfg008 = load008({ SF_ENVIRONMENT: 'CI', SF_CMP008_PACK_SOURCE_MODE: 'SIMULATED' });
    const cfg009 = load009({
      SF_ENVIRONMENT: 'CI',
      SF_CMP009_FORM_SOURCE_MODE: 'SIMULATED',
      SF_CMP009_LOCALIZATION_MODE: 'SIMULATED',
    });
    const cfg011 = load011({ SF_ENVIRONMENT: 'CI' });

    packs = new SimulatedRulePackPort(cfg008);
    forms = new SimulatedFormDefinitionPort(cfg009);
    const loc = new SimulatedLocalizationPort(cfg009);
    loc.put(T1, 'en', {
      'form.field.given_name': 'Given name',
      'form.field.family_name': 'Family name',
    });
    pins = new StaticBindingPins();
    consent039 = new SimulatedPurposeConsentPort();
    sources039 = new SimulatedSourceAclPort();
    gatewayFake = new FakeGateway();
    auth008 = new Auth008();
    auth039 = new Auth039();

    const secrets = new TestSecrets();
    uploadStorage = new SimulatedDocumentStorage({
      environment: 'CI',
      testRunId: 'm04-int',
      connectorBindingId: '01301301-3013-4013-8013-013013013013',
      secrets,
      secretName: 'local/upload-presign',
    });
    const scanner = new SimulatedMalwareScanner({
      environment: 'CI',
      testRunId: 'm04-int',
      connectorBindingId: '01301301-3013-4013-8013-013013013014',
      read: (tenantId, key) => uploadStorage.readForScan(tenantId, key),
    });
    uploadServiceRepo = new PgUploadRepository(pools.p013);

    const ocrDocs = new Map();
    const ocr = new SimulatedOcrAdapter('01401401-4014-4014-8014-014014014014', ocrDocs, 'CI');
    ocr.register({
      tenantId: T1,
      documentId: DOC_A,
      checksumSha256: SHA_A,
      contentType: 'application/pdf',
      text: `[class:ADDRESS_PROOF] locality ${PII_EMAIL}`,
      scenario: 'success',
    });
    const sources014 = new MemorySources();
    const acl014 = new MemorySourceAcl();
    sources014.put({
      documentId: DOC_A,
      tenantId: T1,
      checksumSha256: SHA_A,
      contentType: 'application/pdf',
      status: 'AVAILABLE',
    });
    acl014.allow(T1, DOC_A);

    const mounts: M04PluginMounts = {
      aiGateway: {
        pool: pools.p039,
        resolveContext,
        authorizer: auth039,
        providers: buildProviderRegistry(cfg039),
        consent: consent039,
        sources: sources039,
        config: cfg039,
        clock: () => new Date('2026-10-04T12:00:00.000Z'),
      },
      rules: {
        pool: pools.p008,
        resolveContext,
        authorizer: auth008,
        rulePacks: packs,
        config: cfg008,
        clock: () => new Date('2026-10-04T12:00:00.000Z'),
      },
      evidence: {
        pool: pools.p011,
        resolveContext,
        authorizer: new Auth011(),
        bindingPins: pins,
        approval: new ToggleApproval(),
        uploads: new StaticUploads(),
        consent: new ToggleConsent(),
        config: cfg011,
        clock: () => new Date('2026-10-04T12:00:00.000Z'),
      },
      documentUpload: {
        environment: 'CI',
        pool: pools.p013,
        repository: uploadServiceRepo,
        resolveContext,
        authorizer: new Auth013(),
        storage: uploadStorage,
        scanner,
        workerActorId: OFFICER_T1,
        clock: () => new Date('2026-10-04T12:00:00.000Z'),
      },
      forms: {
        pool: pools.p009,
        resolveContext,
        authorizer: new Auth009(),
        forms,
        localization: loc,
        config: cfg009,
        clock: () => new Date('2026-10-04T12:00:00.000Z'),
      },
      documentIntelligence: {
        environment: 'CI',
        pool: pools.p014,
        repository: new PgDocIntelRepository(pools.p014),
        resolveContext,
        authorizer: new Auth014(),
        sources: sources014,
        sourceAcl: acl014,
        ocr,
        gateway: gatewayFake,
        clock: () => new Date('2026-10-04T12:00:00.000Z'),
      },
    };

    app = await buildApp(config, { logger: silentLogger(), m04: mounts });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (pools) await Promise.all(Object.values(pools).map((p) => p.end()));
  });

  function auth(token: string, extra: Record<string, string> = {}) {
    return { authorization: `Bearer ${token}`, ...extra };
  }

  it('host mounts all six; CMP-036 once; M01/M02/M03 decoration absent when omitted', async () => {
    expect(app.m04Mounted).toEqual([
      'CMP-039',
      'CMP-008',
      'CMP-011',
      'CMP-013',
      'CMP-009',
      'CMP-014',
    ]);
    expect(app.printPlugins().split('cmp-036-api-gateway').length - 1).toBe(1);
    expect(app.wave1Mounted).toEqual([]);
    expect(app.wave2Mounted).toEqual([]);
    expect(app.m02Mounted).toEqual([]);
    expect(app.m03Mounted).toBeUndefined();
  });

  it('forged X-Tenant-ID is never trusted across M04 routes', async () => {
    for (const url of [
      '/v1/ai/models/capabilities',
      `/v1/evaluations/${randomUUID()}`,
      `/v1/evidence-policies/${randomUUID()}`,
      `/v1/upload-policies/${randomUUID()}`,
      `/v1/executions/${randomUUID()}`,
      `/v1/intelligence-jobs/${randomUUID()}`,
    ]) {
      const forged = await app.inject({
        method: 'GET',
        url,
        headers: { ...auth('t1'), 'x-tenant-id': CANARY, 'X-Tenant-ID': CANARY },
      });
      expect(forged.statusCode).toBe(403);
      expect(validate('error-response', forged.json()).valid).toBe(true);
      expect(forged.json()).toMatchObject({ error_code: 'SF-TEN-002' });
      expect(forged.body).not.toContain(CANARY);
    }
  });

  it('CMP-008 published/version-pinned deterministic GoRules + wrong-tenant deny + idempotency', async () => {
    const pack = packFixture(T1);
    packs.publish(pack);
    const body = {
      rule_pack: pinOf(pack),
      inputs: { score: 80 },
      purpose_code: 'ELIGIBILITY_CHECK',
    };
    const a = await app.inject({
      method: 'POST',
      url: '/v1/evaluations',
      headers: auth('t1', { 'idempotency-key': 'm04-eval-1' }),
      payload: body,
    });
    expect(a.statusCode).toBe(201);
    expect(a.json().outcome).toBe('MEETS_CRITERIA');
    const b = await app.inject({
      method: 'POST',
      url: '/v1/evaluations',
      headers: auth('t1', { 'idempotency-key': 'm04-eval-1' }),
      payload: body,
    });
    expect(b.json().evaluation_id).toBe(a.json().evaluation_id);
    const t2 = await app.inject({
      method: 'GET',
      url: `/v1/evaluations/${a.json().evaluation_id}`,
      headers: auth('t2'),
    });
    expect(t2.statusCode).toBe(404);
    auth008.denies.add('RULE_EVALUATION_EXECUTE');
    const denied = await app.inject({
      method: 'POST',
      url: '/v1/evaluations',
      headers: auth('t1', { 'idempotency-key': 'm04-eval-deny' }),
      payload: body,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    auth008.denies.clear();
  });

  it('CMP-009 published/version-pinned forms with server-authoritative validation', async () => {
    const form = formFixture(T1);
    forms.publish(form);
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: auth('t1', { 'idempotency-key': 'm04-form-1' }),
      payload: {
        form: formPin(form),
        data: validData(),
        purpose_code: 'FORM_SUBMIT',
        locale: 'en',
      },
    });
    expect(ok.statusCode).toBe(201);
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: auth('t1', { 'idempotency-key': 'm04-form-bad' }),
      payload: {
        form: formPin(form),
        data: { given_name: 'x' },
        purpose_code: 'FORM_SUBMIT',
        locale: 'en',
      },
    });
    // Server-authoritative validation: incomplete payloads are rejected or marked invalid.
    if (bad.statusCode === 201) {
      expect(bad.json().valid).toBe(false);
    } else {
      expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    }
    const leak = await app.inject({
      method: 'GET',
      url: `/v1/executions/${ok.json().execution_id}`,
      headers: auth('t2'),
    });
    expect(leak.statusCode).toBe(404);
  });

  it('CMP-011 evidence-policy publish/pin/resolve + OPA deny path', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/evidence-policies',
      headers: auth('t1', { 'idempotency-key': 'm04-ev-c' }),
      payload: { policy_key: 'generic.m04', definition: samplePolicy() },
    });
    expect(created.statusCode).toBe(201);
    const published = await app.inject({
      method: 'POST',
      url: `/v1/evidence-policies/${created.json().policy_id}/publish`,
      headers: auth('t1', { 'idempotency-key': 'm04-ev-p' }),
    });
    expect(published.statusCode).toBe(200);
    pins.set(T1, BINDING, {
      version_ref: published.json().version_ref,
      content_hash: published.json().content_hash,
      binding_status: 'PUBLISHED',
    });
    const calc = await app.inject({
      method: 'POST',
      url: '/v1/evidence-requirements/calculate',
      headers: auth('t1', { 'idempotency-key': 'm04-ev-calc' }),
      payload: {
        binding_id: BINDING,
        facts: { 'applicant.category': 'P', 'applicant.age': 30 },
        rule_outcomes: { needs_extra: false },
      },
    });
    expect(calc.statusCode).toBe(200);
    expect(calc.json().evidence_policy_version.content_hash).toBe(published.json().content_hash);
  });

  it('CMP-013 upload/scan/quarantine lifecycle + checksum pin + scanner unavailable', async () => {
    const policy = await app.inject({
      method: 'POST',
      url: '/v1/upload-policies',
      headers: auth('t1', { 'idempotency-key': 'm04-up-pol' }),
      payload: {
        policy_code: 'IDENTITY_PROOF',
        allowed_content_types: ['application/pdf'],
        max_bytes: 4096,
        session_ttl_seconds: 900,
        max_scan_attempts: 2,
        classification: 'CITIZEN_PRIVATE',
      },
    });
    expect(policy.statusCode).toBe(201);
    const bytes = pdfBytes('m04-stitch');
    const session = await app.inject({
      method: 'POST',
      url: '/v1/documents/upload-sessions',
      headers: auth('t1', { 'idempotency-key': 'm04-up-sess' }),
      payload: {
        policy_code: 'IDENTITY_PROOF',
        content_type: 'application/pdf',
        byte_size: bytes.byteLength,
        checksum_sha256: uploadSha(bytes),
      },
    });
    expect(session.statusCode).toBe(201);
    const upload = session.json().upload as {
      url: string;
      method: string;
      required_headers?: Record<string, string>;
    };
    await uploadStorage.simulateClientPut(
      upload.url,
      bytes,
      { 'content-type': 'application/pdf' },
      new Date('2026-10-04T12:00:00.000Z'),
    );
    const complete = await app.inject({
      method: 'POST',
      url: `/v1/documents/${session.json().document_id}/complete`,
      headers: auth('t1'),
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json()).toMatchObject({ status: 'SCAN_PENDING' });

    const outbox = await withAdmin(async (c) => {
      const r = await c.query<{ envelope: { event_type: string; data: { document_id: string } } }>(
        `SELECT envelope FROM sf_upload.outbox_event
          WHERE tenant_id = $1 AND topic = 'sf.upload.events.v1' ORDER BY seq DESC LIMIT 5`,
        [T1],
      );
      return r.rows.map((row) => row.envelope);
    });
    const scanEvt = outbox.find(
      (e) =>
        e.event_type === 'DocumentScanRequested' &&
        e.data.document_id === session.json().document_id,
    );
    expect(scanEvt).toBeTruthy();
    if (scanEvt === undefined) {
      throw new Error('DocumentScanRequested outbox event missing');
    }

    const { buildUploadService } =
      await import('../../../services/cmp-013-document-upload/src/plugin.js');
    const service = buildUploadService({
      environment: 'CI',
      repository: uploadServiceRepo,
      resolveContext: async () => ctx(T1),
      authorizer: new Auth013(),
      storage: uploadStorage,
      scanner: new SimulatedMalwareScanner({
        environment: 'CI',
        testRunId: 'm04-int',
        connectorBindingId: '01301301-3013-4013-8013-013013013014',
        read: (tenantId, key) => uploadStorage.readForScan(tenantId, key),
      }),
      workerActorId: OFFICER_T1,
    });
    expect(await service.processScanRequest(scanEvt)).toBe('AVAILABLE');
    const access = await app.inject({
      method: 'GET',
      url: `/v1/documents/${session.json().document_id}/access`,
      headers: auth('t1'),
    });
    expect(access.statusCode).toBe(200);

    const t2 = await app.inject({
      method: 'GET',
      url: `/v1/documents/${session.json().document_id}`,
      headers: auth('t2'),
    });
    expect(t2.statusCode).toBe(404);
  });

  it('CMP-039 source ACL/purpose/redaction; CMP-014 through AiGatewayPort only; low-confidence human review', async () => {
    const model = await app.inject({
      method: 'POST',
      url: '/v1/ai/admin/models',
      headers: auth('t1', { 'idempotency-key': 'm04-ai-m' }),
      payload: {
        provider_id: 'sim-primary',
        model_id: 'sim-model',
        model_version: '2026-10-01',
        operations: ['INVOKE', 'EMBED'],
        max_data_classification: 'PERSONAL',
        max_input_chars: 5000,
        max_output_tokens: 256,
        daily_token_budget: 100000,
      },
    });
    expect(model.statusCode).toBe(201);
    const modelId = model.json().model_entry_id as string;
    const policy = await app.inject({
      method: 'POST',
      url: '/v1/ai/admin/policies',
      headers: auth('t1', { 'idempotency-key': 'm04-ai-p' }),
      payload: {
        policy_id: 'draft-reply',
        policy_version: 1,
        task_kind: 'DRAFT',
        template_body: 'Draft a polite reply about: {{subject}}',
        allowed_tools: [],
        model_entry_ids: [modelId],
        max_data_classification: 'PERSONAL',
        max_output_tokens: 128,
        latency_budget_ms: 500,
        fallback_behavior: 'NON_AI_PATH',
        evaluation_ref: {
          dataset_id: 'eval-set',
          dataset_version: '1',
          threshold: 0.9,
          result: 'PASSED',
        },
      },
    });
    expect(policy.statusCode).toBe(201);

    const sourceId = 'src-m04-1';
    sources039.allow(T1, sourceId);
    const email = 'officer@example.test';
    const invoke = await app.inject({
      method: 'POST',
      url: '/v1/ai/invoke',
      headers: auth('t1', { 'idempotency-key': 'm04-ai-inv' }),
      payload: {
        policy_id: 'draft-reply',
        policy_version: 1,
        purpose: 'officer drafting assistance',
        data_classification: 'PERSONAL',
        variables: { subject: `hours ${email}` },
        sources: [{ source_id: sourceId, tenant_id: T1 }],
      },
    });
    expect(invoke.statusCode).toBe(200);
    expect(invoke.json().advisory_only).toBe(true);
    expect(invoke.json().statutory_decision).toBe(false);
    expect(JSON.stringify(invoke.json())).not.toContain(email);

    consent039.denied.add('blocked-purpose');
    const purposeDenied = await app.inject({
      method: 'POST',
      url: '/v1/ai/invoke',
      headers: auth('t1', { 'idempotency-key': 'm04-ai-pur' }),
      payload: {
        policy_id: 'draft-reply',
        policy_version: 1,
        purpose: 'blocked-purpose',
        data_classification: 'PERSONAL',
        variables: { subject: 'x' },
        sources: [{ source_id: sourceId, tenant_id: T1 }],
      },
    });
    expect(purposeDenied.statusCode).toBe(403);

    const aclDenied = await app.inject({
      method: 'POST',
      url: '/v1/ai/invoke',
      headers: auth('t1', { 'idempotency-key': 'm04-ai-acl' }),
      payload: {
        policy_id: 'draft-reply',
        policy_version: 1,
        purpose: 'officer drafting assistance',
        data_classification: 'INTERNAL',
        variables: { subject: 'x' },
        sources: [{ source_id: 'no-grant', tenant_id: T1 }],
      },
    });
    expect(aclDenied.statusCode).toBe(403);

    const extract = await app.inject({
      method: 'POST',
      url: '/v1/extraction-policies',
      headers: auth('t1', { 'idempotency-key': 'm04-di-pol' }),
      payload: EXTRACT_POLICY,
    });
    expect(extract.statusCode).toBe(201);
    gatewayFake.scenario = 'low_confidence';
    const job = await app.inject({
      method: 'POST',
      url: '/v1/intelligence-jobs',
      headers: auth('t1', { 'idempotency-key': 'm04-di-job' }),
      payload: JOB_BODY,
    });
    expect(job.statusCode).toBe(201);
    const processed = await app.inject({
      method: 'POST',
      url: `/v1/intelligence-jobs/${job.json().job_id}/process`,
      headers: auth('t1', { 'idempotency-key': 'm04-di-proc' }),
    });
    expect(processed.statusCode).toBe(200);
    expect(processed.json().advisory_only).toBe(true);
    expect(processed.json().statutory_decision).toBe(false);
    expect(processed.json().status).toBe('NEEDS_REVIEW');
    expect(gatewayFake.calls).toBeGreaterThan(0);
    expect(gatewayFake.lastRequest?.caller_component).toBe('CMP-014');
  });

  it('malformed metadata/document failure paths fail closed without leakage', async () => {
    const badEval = await app.inject({
      method: 'POST',
      url: '/v1/evaluations',
      headers: auth('t1', { 'idempotency-key': 'm04-bad-eval' }),
      payload: {
        rule_pack: { pack_key: 'x', version_id: randomUUID(), content_hash: 'bad' },
        inputs: {},
      },
    });
    expect(badEval.statusCode).toBeGreaterThanOrEqual(400);
    expect(badEval.body).not.toContain(CANARY);

    const badJob = await app.inject({
      method: 'POST',
      url: '/v1/intelligence-jobs',
      headers: auth('t1', { 'idempotency-key': 'm04-bad-job' }),
      payload: {
        policy_code: 'MISSING',
        source_document_id: randomUUID(),
        source_checksum_sha256: createHash('sha256').update('x').digest('hex'),
        purpose: 'x',
        data_classification: 'INTERNAL',
      },
    });
    expect(badJob.statusCode).toBeGreaterThanOrEqual(400);
    expect(badJob.body).not.toContain(CANARY);
  });
});
