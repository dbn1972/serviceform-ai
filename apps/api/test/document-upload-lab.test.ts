import { describe, expect, it } from 'vitest';
import {
  documentOwnerEnrichingAuthorizer,
  parseUploadPolicyFixture,
  SAMPLE_LAB_UPLOAD_POLICY_CODE,
  seedLabUploadPolicy,
} from '../src/platform/document-upload.js';

describe('SAMPLE_LAB CMP-013 composition helpers (SF-49)', () => {
  it('parses the SIMULATED upload policy fixture and refuses non-SIMULATED', () => {
    const fixture = parseUploadPolicyFixture(
      {
        simulation: 'SIMULATED',
        policy_code: SAMPLE_LAB_UPLOAD_POLICY_CODE,
        allowed_content_types: ['application/pdf'],
        max_bytes: 1024,
        session_ttl_seconds: 900,
        max_scan_attempts: 2,
        classification: 'CITIZEN_PRIVATE',
      },
      'LOCAL',
    );
    expect(fixture.policy_code).toBe(SAMPLE_LAB_UPLOAD_POLICY_CODE);
    expect(() => parseUploadPolicyFixture({ ...fixture, simulation: 'REAL' }, 'LOCAL')).toThrow(
      /SIMULATED/,
    );
  });

  it('seeds upload policy with sha256: fingerprint (CMP-013 idempotency CHECK)', async () => {
    const seen: { fingerprint?: string }[] = [];
    const service = {
      createPolicyVersion: async (
        _ctx: unknown,
        _input: unknown,
        idem: { fingerprint: string },
      ) => {
        seen.push(idem);
        return { status: 201, body: { ok: true } };
      },
    };
    const fixture = parseUploadPolicyFixture(
      {
        simulation: 'SIMULATED',
        policy_code: SAMPLE_LAB_UPLOAD_POLICY_CODE,
        allowed_content_types: ['application/pdf'],
        max_bytes: 1024,
        session_ttl_seconds: 900,
        max_scan_attempts: 2,
        classification: 'CITIZEN_PRIVATE',
      },
      'LOCAL',
    );
    await seedLabUploadPolicy({
      service: service as never,
      fixture,
      ctx: { tenant_id: '11111111-1111-4111-8111-111111111111' } as never,
    });
    expect(seen[0]?.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('injects citizen self-owner on DOCUMENT_UPLOAD_SESSION_CREATE', async () => {
    const seen: unknown[] = [];
    const pdp = {
      decide: async (input: unknown) => {
        seen.push(input);
        return { allow: true, reason_code: 'OK', policy_revision: 'test' };
      },
    };
    const authorizer = documentOwnerEnrichingAuthorizer(pdp as never);
    await authorizer.decide({
      subject: {
        user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        actor_type: 'CITIZEN',
        tenant_id: '11111111-1111-4111-8111-111111111111',
        roles: [],
        jurisdiction_ids: [],
        assurance: 'OTP',
      },
      resource: {
        resource_type: 'Document',
        tenant_id: '11111111-1111-4111-8111-111111111111',
      },
      action: 'DOCUMENT_UPLOAD_SESSION_CREATE',
      environment: { request_time: '2026-11-21T00:00:00Z' },
    });
    expect(seen[0]).toMatchObject({
      resource: {
        owner_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        classification: 'CITIZEN_PRIVATE',
      },
    });
  });
});
