import { describe, expect, it } from 'vitest';
import { SimulatedMalwareScanner } from '../../src/adapters/simulated-scanner.js';
import { SimulatedDocumentStorage } from '../../src/adapters/simulated-storage.js';
import { requireTenantContext } from '../../src/context.js';
import { sniffContentType, SNIFFABLE_CONTENT_TYPES } from '../../src/domain/content-type.js';
import {
  documentObjectKey,
  isKeyOwnedByTenant,
  isSafeObjectKey,
} from '../../src/domain/object-key.js';
import {
  assertDeclarationAllowed,
  assertPolicyUsable,
  evaluateObserved,
  type UploadPolicy,
} from '../../src/domain/policy.js';
import { assertSimulationPolicy } from '../../src/domain/simulation.js';
import { canTransition, isUsableAsEvidence } from '../../src/domain/states.js';
import { Cmp013Error, mapPgError } from '../../src/errors.js';
import {
  ctx,
  pdfBytes,
  sha256,
  STORAGE_BINDING,
  T1,
  T2,
  TestSecrets,
} from '../doubles/fixtures.js';

const DOC = '33333333-3333-4333-8333-333333333333';
const SHA = 'a'.repeat(64);

const policy: UploadPolicy = {
  policy_id: '44444444-4444-4444-8444-444444444444',
  policy_code: 'IDENTITY_PROOF',
  version_no: 1,
  status: 'ACTIVE',
  allowed_content_types: ['application/pdf'],
  max_bytes: 100,
  session_ttl_seconds: 900,
  max_scan_attempts: 1,
  classification: 'TENANT_SCOPED',
};

describe('traversal-safe object keys', () => {
  it('builds tenant/cell-scoped keys from server ids only', () => {
    const key = documentObjectKey({
      tenantId: T1,
      cellId: 'cell-01',
      documentId: DOC,
      checksumSha256: SHA,
    });
    expect(key).toBe(`t/${T1}/c/cell-01/o/${DOC}/${SHA.slice(0, 12)}`);
    expect(isKeyOwnedByTenant(key, T1)).toBe(true);
    expect(isKeyOwnedByTenant(key, T2)).toBe(false);
  });

  it.each([
    '',
    '../t/x',
    't/../x',
    't/./x',
    '/t/x',
    't/x/',
    't//x',
    't\\x',
    't/%2e%2e/x',
    't/x\u0000',
    't/x y',
    't/名前',
    'x'.repeat(513),
  ])('refuses unsafe key %j', (key) => {
    expect(isSafeObjectKey(key)).toBe(false);
  });

  it('refuses non-uuid ids, bad cells and bad checksums', () => {
    for (const input of [
      { tenantId: '../x', cellId: 'cell-01', documentId: DOC, checksumSha256: SHA },
      { tenantId: T1, cellId: '../cell', documentId: DOC, checksumSha256: SHA },
      { tenantId: T1, cellId: 'cell-01', documentId: 'x/../y', checksumSha256: SHA },
      { tenantId: T1, cellId: 'cell-01', documentId: DOC, checksumSha256: '../' },
    ]) {
      expect(() => documentObjectKey(input)).toThrow(Cmp013Error);
    }
  });
});

describe('content sniffing and policy evaluation', () => {
  it('recognises every allowed signature and nothing else', () => {
    const samples: Record<string, number[]> = {
      'application/pdf': [...Buffer.from('%PDF-1.4')],
      'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
      'image/gif': [...Buffer.from('GIF89a')],
      'image/tiff': [0x49, 0x49, 0x2a, 0x00],
      'image/webp': [...Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBP')],
    };
    for (const type of SNIFFABLE_CONTENT_TYPES) {
      expect(sniffContentType(Uint8Array.from(samples[type] ?? []))).toBe(type);
    }
    expect(sniffContentType(Buffer.from('<html>'))).toBeNull();
    expect(sniffContentType(new Uint8Array(0))).toBeNull();
  });

  it('fails closed on missing/retired/invalid policies', () => {
    expect(() => assertPolicyUsable(null)).toThrow(Cmp013Error);
    expect(() => assertPolicyUsable({ ...policy, status: 'RETIRED' })).toThrow(Cmp013Error);
    expect(() => assertPolicyUsable({ ...policy, allowed_content_types: ['text/html'] })).toThrow(
      Cmp013Error,
    );
    expect(() => assertPolicyUsable({ ...policy, allowed_content_types: [] })).toThrow(Cmp013Error);
    expect(() => assertPolicyUsable({ ...policy, max_bytes: 0 })).toThrow(Cmp013Error);
    expect(assertPolicyUsable(policy)).toBe(policy);
  });

  it('checks declarations and observed bytes against the pinned policy', () => {
    const decl = { content_type: 'application/pdf', byte_size: 10, checksum_sha256: SHA };
    expect(() => assertDeclarationAllowed(policy, { ...decl, byte_size: 0 })).toThrow();
    expect(() => assertDeclarationAllowed(policy, { ...decl, byte_size: 1.5 })).toThrow();
    expect(() => assertDeclarationAllowed(policy, decl)).not.toThrow();
    const bytes = pdfBytes();
    const good = {
      content_type: 'application/pdf',
      byte_size: bytes.length,
      checksum_sha256: sha256(bytes),
    };
    const obs = {
      byte_size: bytes.length,
      checksum_sha256: sha256(bytes),
      head: bytes.slice(0, 16),
    };
    expect(evaluateObserved(policy, good, obs)).toEqual({
      ok: true,
      detected_content_type: 'application/pdf',
    });
    expect(evaluateObserved({ ...policy, max_bytes: 5 }, good, obs)).toEqual({
      ok: false,
      code: 'SIZE_EXCEEDS_POLICY',
    });
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(
      evaluateObserved(
        policy,
        { ...good, byte_size: 8, checksum_sha256: sha256(png) },
        { byte_size: 8, checksum_sha256: sha256(png), head: png },
      ),
    ).toEqual({ ok: false, code: 'CONTENT_TYPE_NOT_ALLOWED' });
  });

  it('only AVAILABLE is technically accepted; terminal states are final', () => {
    expect(isUsableAsEvidence('AVAILABLE')).toBe(true);
    for (const s of ['PENDING_UPLOAD', 'SCAN_PENDING', 'REJECTED'] as const) {
      expect(isUsableAsEvidence(s)).toBe(false);
    }
    expect(canTransition('PENDING_UPLOAD', 'AVAILABLE')).toBe(false);
    expect(canTransition('SCAN_PENDING', 'AVAILABLE')).toBe(true);
    expect(canTransition('REJECTED', 'AVAILABLE')).toBe(false);
    expect(canTransition('AVAILABLE', 'REJECTED')).toBe(false);
  });
});

describe('errors, context and INT-013 policy', () => {
  it('maps database errors to catalogue codes', () => {
    expect(mapPgError({ code: '42501' }).code).toBe('SF-TEN-002');
    expect(mapPgError({ code: '23505' }).code).toBe('SF-APP-002');
    expect(mapPgError({ code: '23503' }).code).toBe('SF-SYS-002');
    expect(mapPgError({ code: '23514' }).code).toBe('SF-SYS-003');
    expect(mapPgError({ code: 'P0001' }).code).toBe('SF-APP-001');
    expect(mapPgError(new Error('x')).code).toBe('SF-SYS-001');
  });

  it('requires a contract-valid tenant context', () => {
    expect(() => requireTenantContext(null)).toThrow(Cmp013Error);
    expect(() => requireTenantContext({ tenant_id: T1 })).toThrow(Cmp013Error);
    const c = ctx({ tenant_id: T1, actor: { type: 'CITIZEN', id: T2 } });
    expect(requireTenantContext(c).tenant_id).toBe(T1);
  });

  it('enforces SIMULATED environment rules and marker validity', () => {
    expect(() =>
      assertSimulationPolicy([{ critical: false, mode: 'SIMULATED', environment: 'UAT' }]),
    ).toThrow(expect.objectContaining({ details: [{ code: 'SIMULATED_ENVIRONMENT_REFUSED' }] }));
    expect(() =>
      assertSimulationPolicy([
        { critical: true, mode: 'SIMULATED', environment: 'CI', connector_binding_id: 'nope' },
      ]),
    ).toThrow(expect.objectContaining({ details: [{ code: 'INVALID_SIMULATION_MARKER' }] }));
    expect(() =>
      assertSimulationPolicy([{ critical: true, mode: 'REAL', environment: 'PRODUCTION' }]),
    ).not.toThrow();
  });
});

describe('SIMULATED adapters (INT-013, no durable filesystem)', () => {
  const secrets = new TestSecrets();
  const make = () =>
    new SimulatedDocumentStorage({
      environment: 'LOCAL',
      testRunId: 'cmp-013-unit',
      connectorBindingId: STORAGE_BINDING,
      secrets,
      secretName: 'local/upload-presign',
    });
  const key = documentObjectKey({
    tenantId: T1,
    cellId: 'cell-01',
    documentId: DOC,
    checksumSha256: SHA,
  });

  it('refuses non-simulation environments at construction', () => {
    for (const environment of ['PRODUCTION', 'UAT', 'PREPROD']) {
      expect(
        () =>
          new SimulatedDocumentStorage({
            environment,
            testRunId: 't',
            connectorBindingId: STORAGE_BINDING,
            secrets,
            secretName: 's',
          }),
      ).toThrow();
      expect(
        () =>
          new SimulatedMalwareScanner({
            environment,
            testRunId: 't',
            connectorBindingId: STORAGE_BINDING,
            read: async () => null,
          }),
      ).toThrow();
    }
  });

  it('rejects forged, expired and wrong content-type uploads; never overwrites', async () => {
    const s = make();
    const bytes = pdfBytes();
    const now = new Date('2026-10-04T12:00:00Z');
    const target = await s.issueUploadTarget({
      tenantId: T1,
      objectKey: key,
      contentType: 'application/pdf',
      byteSize: bytes.length,
      checksumSha256: sha256(bytes),
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect(target.url).not.toContain('test-only-hmac-key');
    const forged = target.url.replace(/sig=[0-9a-f]+/, `sig=${'0'.repeat(64)}`);
    await expect(
      s.simulateClientPut(forged, bytes, { 'content-type': 'application/pdf' }, now),
    ).rejects.toThrow();
    await expect(
      s.simulateClientPut(target.url, bytes, { 'content-type': 'image/png' }, now),
    ).rejects.toThrow();
    await expect(
      s.simulateClientPut(
        target.url,
        bytes,
        { 'content-type': 'application/pdf' },
        new Date(now.getTime() + 120_000),
      ),
    ).rejects.toThrow();
    await expect(
      s.simulateClientPut('https://elsewhere/x', bytes, { 'content-type': 'application/pdf' }),
    ).rejects.toThrow();
    await s.simulateClientPut(target.url, bytes, { 'content-type': 'application/pdf' }, now);
    await expect(
      s.simulateClientPut(
        target.url,
        pdfBytes('other'),
        { 'content-type': 'application/pdf' },
        now,
      ),
    ).rejects.toThrow();
    const seen = await s.inspectObject({ tenantId: T1, objectKey: key });
    expect(seen?.checksum_sha256).toBe(sha256(bytes));
    expect(seen?.head.byteLength).toBe(16);
  });

  it('keeps objects quarantined until released; refuses cross-tenant keys', async () => {
    const s = make();
    await expect(
      s.issueUploadTarget({
        tenantId: T2,
        objectKey: key,
        contentType: 'application/pdf',
        byteSize: 1,
        checksumSha256: SHA,
        expiresAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'OBJECT_NOT_OWNED' });
    await expect(s.releaseFromQuarantine({ tenantId: T1, objectKey: key })).rejects.toMatchObject({
      code: 'OBJECT_NOT_FOUND',
    });
    await expect(
      s.issueDownloadAccess({ tenantId: T1, objectKey: key, expiresAt: new Date() }),
    ).rejects.toMatchObject({ code: 'OBJECT_QUARANTINED' });
    await expect(s.discard({ tenantId: T1, objectKey: key })).resolves.toBeUndefined();
    expect(await s.readForScan(T1, key)).toBeNull();
  });

  it('scanner fails closed when the object is missing', async () => {
    const scanner = new SimulatedMalwareScanner({
      environment: 'CI',
      testRunId: 't',
      connectorBindingId: STORAGE_BINDING,
      read: async () => null,
    });
    await expect(scanner.scan({ tenantId: T1, objectKey: key })).rejects.toThrow();
  });
});
