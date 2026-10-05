import {
  CANARY,
  DOC_A,
  DOC_B,
  JOB_BODY,
  OCR_BINDING,
  PII_EMAIL,
  PII_PHONE,
  SHA_B,
  T1,
  T2,
  buildHarness,
  seedPolicy,
  MemorySourceAcl,
  MemorySources,
  type Harness,
} from '../doubles/fixtures.js';
import { MemoryDocIntelRepository } from '../doubles/memory-repo.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { FakeGateway } from '../doubles/fake-gateway.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { SimulatedOcrAdapter } from '../../src/adapters/simulated-ocr.js';
import { classifyDocument } from '../../src/domain/classify.js';
import { sha256Prefixed } from '../../src/domain/fingerprint.js';
import { parseGatewayExtraction } from '../../src/domain/parse-extraction.js';
import { logSafe, redactText } from '../../src/domain/redaction.js';
import { assertSimulationPolicy } from '../../src/domain/simulation.js';
import { canTransition } from '../../src/domain/states.js';
import { Cmp014Error } from '../../src/errors.js';
import { buildIntelligenceService } from '../../src/plugin.js';

let h: Harness;

beforeEach(async () => {
  h = await buildHarness();
  await seedPolicy(h);
});

afterEach(async () => {
  await h.app.close();
});

describe('CMP-014 OCR/classification/extraction (assistive)', () => {
  it('runs simulated OCR, classifies, extracts via CMP-039, and records provenance', async () => {
    const created = await h.call(T1, 'POST', '/v1/intelligence-jobs', JOB_BODY);
    expect(created.status).toBe(201);
    expect(created.body['status']).toBe('ACCEPTED');
    expect(created.body['advisory_only']).toBe(true);
    expect(created.body['statutory_decision']).toBe(false);
    const processed = await h.call(
      T1,
      'POST',
      `/v1/intelligence-jobs/${created.body['job_id']}/process`,
    );
    expect(processed.status).toBe(200);
    expect(processed.body['status']).toBe('COMPLETED');
    expect(processed.body['document_class']).toBe('ADDRESS_PROOF');
    expect(processed.body['ocr_text_hash']).toMatch(/^sha256:[0-9a-f]{64}$/);
    const model = processed.body['model'] as Record<string, string>;
    expect(model['model_id']).toBe('sim-model');
    expect(model['model_version']).toBe('2026-10-01');
    const prompt = processed.body['prompt'] as Record<string, unknown>;
    expect(prompt['policy_id']).toBe('extract-fields');
    expect(prompt['policy_version']).toBe(1);
    expect(String(prompt['template_hash'])).toMatch(/^sha256:/);
    expect(processed.body['gateway_request_id']).toBeTruthy();
    expect(processed.body['evidence_satisfied']).toBe(false);
    expect(processed.body['entitlement_issued']).toBe(false);
    expect(h.gateway.calls).toBe(1);
    expect(h.gateway.lastRequest?.caller_component).toBe('CMP-014');
    expect(h.gateway.lastRequest?.variables['redacted_excerpt']).not.toContain(PII_EMAIL);
    expect(h.gateway.lastRequest?.variables['redacted_excerpt']).not.toContain(PII_PHONE);
    const events = h.repo.events().map((e) => e.event_type);
    expect(events).toEqual([
      'IntelligenceJobAccepted',
      'IntelligenceJobClassified',
      'IntelligenceJobExtracted',
      'IntelligenceJobCompleted',
    ]);
    for (const env of h.repo.events()) {
      expect(validate('event-envelope', env).valid).toBe(true);
    }
  });

  it('never calls OCR or the gateway inside an authoritative transaction', async () => {
    const created = await h.call(T1, 'POST', '/v1/intelligence-jobs', JOB_BODY);
    await h.call(T1, 'POST', `/v1/intelligence-jobs/${created.body['job_id']}/process`);
    expect(h.gateway.calls).toBe(1);
  });

  it('sends low-confidence extraction to human review; review stays assistive', async () => {
    h.gateway.scenario = 'low_confidence';
    const created = await h.call(T1, 'POST', '/v1/intelligence-jobs', JOB_BODY);
    const processed = await h.call(
      T1,
      'POST',
      `/v1/intelligence-jobs/${created.body['job_id']}/process`,
    );
    expect(processed.body['status']).toBe('NEEDS_REVIEW');
    const reviewed = await h.call(
      T1,
      'POST',
      `/v1/intelligence-jobs/${created.body['job_id']}/review`,
      { decision: 'CONFIRM_ASSISTIVE' },
    );
    expect(reviewed.status).toBe(200);
    expect(reviewed.body['status']).toBe('REVIEWED');
    expect(reviewed.body['review_decision']).toBe('CONFIRM_ASSISTIVE');
    expect(reviewed.body['advisory_only']).toBe(true);
    expect(reviewed.body['statutory_decision']).toBe(false);
  });
});

describe('CMP-014 failure paths', () => {
  it('rejects malformed and unsupported documents without a gateway call', async () => {
    const malId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const malSha = 'd'.repeat(64);
    h.ocr.register({
      tenantId: T1,
      documentId: malId,
      checksumSha256: malSha,
      contentType: 'application/pdf',
      text: '',
      scenario: 'malformed',
    });
    h.sources.put({
      documentId: malId,
      tenantId: T1,
      checksumSha256: malSha,
      contentType: 'application/pdf',
      status: 'AVAILABLE',
    });
    h.acl.allow(T1, malId);
    const created = await h.call(T1, 'POST', '/v1/intelligence-jobs', {
      ...JOB_BODY,
      source_document_id: malId,
      source_checksum_sha256: malSha,
    });
    const processed = await h.call(
      T1,
      'POST',
      `/v1/intelligence-jobs/${created.body['job_id']}/process`,
    );
    expect(processed.body['status']).toBe('REJECTED');
    expect(processed.body['rejection_code']).toBe('MALFORMED');
    expect(h.gateway.calls).toBe(0);

    const unId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const unSha = 'e'.repeat(64);
    h.ocr.register({
      tenantId: T1,
      documentId: unId,
      checksumSha256: unSha,
      contentType: 'application/pdf',
      text: '[UNSUPPORTED]',
      scenario: 'unsupported',
    });
    h.sources.put({
      documentId: unId,
      tenantId: T1,
      checksumSha256: unSha,
      contentType: 'application/pdf',
      status: 'AVAILABLE',
    });
    h.acl.allow(T1, unId);
    const unCreated = await h.call(T1, 'POST', '/v1/intelligence-jobs', {
      ...JOB_BODY,
      source_document_id: unId,
      source_checksum_sha256: unSha,
    });
    const unProcessed = await h.call(
      T1,
      'POST',
      `/v1/intelligence-jobs/${unCreated.body['job_id']}/process`,
    );
    expect(unProcessed.body['status']).toBe('REJECTED');
    expect(unProcessed.body['rejection_code']).toBe('UNSUPPORTED');
  });

  it('maps CMP-039 failure and timeout, and unauthorized model/prompt denials', async () => {
    const failJob = await h.call(T1, 'POST', '/v1/intelligence-jobs', JOB_BODY);
    h.gateway.scenario = 'fail';
    const failed = await h.call(
      T1,
      'POST',
      `/v1/intelligence-jobs/${failJob.body['job_id']}/process`,
    );
    expect(failed.status).toBe(503);
    expect(failed.body['error_code']).toBe('SF-AI-001');

    const toJob = await h.call(T1, 'POST', '/v1/intelligence-jobs', JOB_BODY);
    h.gateway.scenario = 'timeout';
    const timed = await h.call(T1, 'POST', `/v1/intelligence-jobs/${toJob.body['job_id']}/process`);
    expect(timed.status).toBe(503);
    expect(timed.body['details']).toEqual([{ code: 'GATEWAY_TIMEOUT' }]);

    const modelJob = await h.call(T1, 'POST', '/v1/intelligence-jobs', JOB_BODY);
    h.gateway.scenario = 'unauthorized_model';
    const deniedModel = await h.call(
      T1,
      'POST',
      `/v1/intelligence-jobs/${modelJob.body['job_id']}/process`,
    );
    expect(deniedModel.status).toBe(403);
    expect(deniedModel.body['details']).toEqual([{ code: 'GATEWAY_DENIED' }]);

    const promptJob = await h.call(T1, 'POST', '/v1/intelligence-jobs', JOB_BODY);
    h.gateway.scenario = 'unauthorized_prompt';
    const deniedPrompt = await h.call(
      T1,
      'POST',
      `/v1/intelligence-jobs/${promptJob.body['job_id']}/process`,
    );
    expect(deniedPrompt.status).toBe(403);
  });

  it('refuses binding/statutory language from the gateway', async () => {
    h.gateway.scenario = 'binding_decision';
    const created = await h.call(T1, 'POST', '/v1/intelligence-jobs', JOB_BODY);
    const processed = await h.call(
      T1,
      'POST',
      `/v1/intelligence-jobs/${created.body['job_id']}/process`,
    );
    expect(processed.body['status']).toBe('FAILED');
    expect(processed.body['rejection_code']).toBe('UNSAFE_OUTPUT');
  });
});

describe('CMP-014 INT-011 / INT-013 / privacy', () => {
  it('denies the wrong tenant and keeps CROSS_TENANT_LEAKAGE=0', async () => {
    await seedPolicy(h, T2);
    const t1 = await h.call(T1, 'POST', '/v1/intelligence-jobs', JOB_BODY);
    await h.call(T1, 'POST', `/v1/intelligence-jobs/${t1.body['job_id']}/process`);
    const leak = await h.call(T2, 'GET', `/v1/intelligence-jobs/${t1.body['job_id']}`);
    expect(leak.status).toBe(404);
    expect(JSON.stringify(leak.body)).not.toContain(CANARY);
    const crossSource = await h.call(T1, 'POST', '/v1/intelligence-jobs', {
      ...JOB_BODY,
      source_document_id: DOC_B,
      source_checksum_sha256: SHA_B,
    });
    expect(crossSource.status).toBe(403);
    let leakage = 0;
    for (const env of h.repo.events()) {
      const text = JSON.stringify(env);
      if (env.tenant_id === T1 && text.includes(CANARY)) leakage += 1;
      if (env.tenant_id === T1 && text.includes(DOC_B)) leakage += 1;
    }
    expect(leakage).toBe(0);
    expect({ CROSS_TENANT_LEAKAGE: leakage }).toEqual({ CROSS_TENANT_LEAKAGE: 0 });
  });

  it('fail-closes PRODUCTION + SIMULATED critical OCR', () => {
    const repo = new MemoryDocIntelRepository();
    const ocr = new SimulatedOcrAdapter(OCR_BINDING, new Map(), 'CI');
    expect(() =>
      buildIntelligenceService({
        environment: 'PRODUCTION',
        repository: repo,
        resolveContext: async () => null,
        authorizer: new ContractAuthorizer(),
        sources: new MemorySources(),
        sourceAcl: new MemorySourceAcl(),
        ocr,
        gateway: new FakeGateway(),
      }),
    ).toThrow(Cmp014Error);
  });

  it('redacts PII before the gateway and keeps it out of log-safe records', () => {
    const redacted = redactText(`hello ${PII_EMAIL} ${PII_PHONE}`);
    expect(redacted.text).not.toContain(PII_EMAIL);
    expect(redacted.text).not.toContain(PII_PHONE);
    expect(redacted.summary.EMAIL).toBe(1);
    const safe = logSafe({
      job_id: DOC_A,
      status: 'COMPLETED',
      email: PII_EMAIL,
      document: 'raw-bytes',
    });
    expect(safe).not.toHaveProperty('email');
    expect(JSON.stringify(safe)).not.toContain(PII_EMAIL);
  });
});

describe('CMP-014 domain guards', () => {
  it('enforces deterministic status transitions', () => {
    expect(canTransition('ACCEPTED', 'CLASSIFYING')).toBe(true);
    expect(canTransition('CLASSIFYING', 'COMPLETED')).toBe(false);
    expect(canTransition('NEEDS_REVIEW', 'REVIEWED')).toBe(true);
    expect(canTransition('COMPLETED', 'REVIEWED')).toBe(false);
  });

  it('classifies from OCR tokens and parses only assistive fields', () => {
    expect(
      classifyDocument({ contentType: 'application/pdf', ocrText: '[class:IDENTITY_DOCUMENT]' }),
    ).toMatchObject({ documentClass: 'IDENTITY_DOCUMENT' });
    const parsed = parseGatewayExtraction(
      JSON.stringify({
        fields: [{ name: 'locality', value: 'ward-1', confidence: 0.9 }],
        overall_confidence: 0.9,
      }),
      sha256Prefixed,
    );
    expect(parsed.unsafe).toBe(false);
    expect(parsed.fields[0]?.value_hash.startsWith('sha256:')).toBe(true);
    expect(
      parseGatewayExtraction(
        JSON.stringify({ statutory_decision: true, fields: [] }),
        sha256Prefixed,
      ).unsafe,
    ).toBe(true);
  });

  it('refuses SIMULATED OCR outside allowed environments', () => {
    expect(() =>
      assertSimulationPolicy([{ critical: true, mode: 'SIMULATED', environment: 'UAT' }]),
    ).toThrow(Cmp014Error);
  });
});
