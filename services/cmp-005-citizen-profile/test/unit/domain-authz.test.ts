import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { AuthzDecisionInput, RequestContext } from '@serviceform/contracts';
import { authorize } from '../../src/authz.js';
import {
  assertNoTenantIdentifyingHeaders,
  isForbiddenHeaderName,
  requireContext,
} from '../../src/context.js';
import { Cmp005Error, mapPgError } from '../../src/errors.js';
import { auditEvent, shouldWriteDeniedAudit } from '../../src/audit.js';
import { currentClient } from '../../src/db/tx.js';
import { canonicalJson, requestFingerprint, valueSha256 } from '../../src/domain/fingerprint.js';
import { isKnownClaim } from '../../src/domain/claim-catalog.js';
import { canExposeClaimValues, evaluateProvenance } from '../../src/domain/provenance.js';
import { assertBindingSafe, requireSimulationMarker } from '../../src/domain/connector-guard.js';
import { assertNoOpenTransaction, runWithTxnFlag } from '../../src/domain/txn-guard.js';
import { SimulatedDigiLockerAdapter } from '../../src/connectors/digilocker-simulated.js';
import { BINDING, T1 } from './memory-pool.js';

const ctx: RequestContext = {
  tenant_id: T1,
  cell_id: 'cell-01',
  actor: { type: 'OFFICER', id: '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42' },
  roles: ['SERVICE_CHECKER'],
  jurisdiction_ids: [],
  auth_assurance: 'MFA',
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  trace_id: '0af7651916cd43dd8448eb211c80319c',
};

const input: AuthzDecisionInput = {
  subject: {
    user_id: ctx.actor.id,
    actor_type: ctx.actor.type,
    tenant_id: ctx.tenant_id,
    roles: ctx.roles,
    jurisdiction_ids: ctx.jurisdiction_ids,
  },
  resource: {
    resource_type: 'CitizenProfile',
    tenant_id: ctx.tenant_id,
    classification: 'CITIZEN_PRIVATE',
  },
  action: 'PROFILE_READ',
};

describe('authorize fail-closed', () => {
  it('denies malformed input, PDP throw, and deny', async () => {
    await expect(
      authorize({ decide: async () => ({ allow: true }) as never }, {} as never),
    ).rejects.toBeInstanceOf(Cmp005Error);
    await expect(
      authorize(
        {
          decide: async () => {
            throw new Error('timeout');
          },
        },
        input,
      ),
    ).rejects.toMatchObject({ code: 'SF-SYS-004' });
    await expect(
      authorize(
        {
          decide: async () => ({
            allow: false,
            reason_code: 'DEFAULT_DENY',
            policy_revision: '1',
            decision_id: randomUUID(),
          }),
        },
        input,
      ),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
  });

  it('denies tenant mismatch on CITIZEN_PRIVATE resources', async () => {
    await expect(
      authorize(
        {
          decide: async () => ({
            allow: true,
            reason_code: 'ALLOW',
            policy_revision: '1',
            decision_id: randomUUID(),
          }),
        },
        {
          ...input,
          resource: {
            ...input.resource,
            tenant_id: '22222222-2222-4222-8222-222222222222',
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    await expect(
      authorize(
        {
          decide: async () => ({
            allow: true,
            reason_code: 'ALLOW',
            policy_revision: '1',
            decision_id: randomUUID(),
          }),
        },
        {
          ...input,
          resource: {
            resource_type: 'CitizenProfile',
            tenant_id: '22222222-2222-4222-8222-222222222222',
            classification: 'TENANT_SCOPED',
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
  });
});

describe('context, errors, catalog, provenance', () => {
  it('rejects tenant-identifying headers and maps pg errors', () => {
    expect(isForbiddenHeaderName('x-tenant-id')).toBe(true);
    expect(() =>
      assertNoTenantIdentifyingHeaders({ headers: { forwarded: 'for=1;tenant=abc' } } as never),
    ).toThrow(Cmp005Error);
    expect(() => requireContext(null, true)).toThrow(Cmp005Error);
    expect(mapPgError({ code: '42501' }).code).toBe('SF-TEN-002');
    expect(mapPgError({ code: '23505' }).code).toBe('SF-APP-002');
    expect(mapPgError({ code: '23503' }).code).toBe('SF-SYS-002');
    expect(mapPgError({ code: '23514' }).code).toBe('SF-SYS-003');
    expect(mapPgError(new Error('x')).code).toBe('SF-SYS-001');
    expect(() => currentClient()).toThrow(Cmp005Error);
    const event = auditEvent(ctx, {
      action: 'PROFILE_READ',
      actionClass: 'READ',
      resourceType: 'CitizenProfile',
      resourceId: randomUUID(),
      result: 'SUCCESS',
      now: new Date('2026-10-04T00:00:00.000Z'),
    });
    expect(event.classification).toBe('CITIZEN_PRIVATE');
    const now = Date.now();
    for (let i = 0; i < 20; i += 1) expect(shouldWriteDeniedAudit('a', '/x', now)).toBe(true);
    expect(shouldWriteDeniedAudit('a', '/x', now)).toBe(false);
  });

  it('keeps claim catalog non-statutory and provenance fail-closed', () => {
    expect(isKnownClaim('IDENTITY', 'DISPLAY_NAME')).toBe(true);
    expect(isKnownClaim('IDENTITY', 'CASTE')).toBe(false);
    expect(isKnownClaim('IDENTITY', 'RELIGION')).toBe(false);
    expect(
      evaluateProvenance({
        existingStatus: 'VERIFIED',
        nextSourceKind: 'SELF',
        nextStatus: 'UNVERIFIED',
      }),
    ).toBe('REJECT_DOWNGRADE');
    expect(
      evaluateProvenance({
        existingStatus: null,
        nextSourceKind: 'SELF',
        nextStatus: 'VERIFIED',
      }),
    ).toBe('REJECT_CLIENT_VERIFIED');
    expect(
      canExposeClaimValues({
        actorId: 'a',
        actorType: 'CITIZEN',
        subjectId: 'b',
        consentAllowed: true,
      }),
    ).toBe(false);
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(requestFingerprint('PUT', '/x', { a: 1 }).startsWith('sha256:')).toBe(true);
    expect(valueSha256('x').startsWith('sha256:')).toBe(true);
  });
});

describe('INT-013 DigiLocker SIMULATED fail-closed', () => {
  it('refuses production simulated and outbound inside a transaction', async () => {
    expect(() =>
      assertBindingSafe(
        { ...BINDING, mode: 'SIMULATED', environment: 'PRODUCTION' },
        'PRODUCTION',
        T1,
      ),
    ).toThrow(/SF-SYS-003|Request validation|PRODUCTION/i);
    expect(() =>
      assertBindingSafe(
        { ...BINDING, tenant_id: '22222222-2222-4222-8222-222222222222' },
        'CI',
        T1,
      ),
    ).toThrow(Cmp005Error);
    const marker = requireSimulationMarker({
      environment: 'CI',
      scenario: 'happy',
      testRunId: 'run-1',
      connectorBindingId: BINDING.connector_binding_id,
    });
    expect(marker.simulation).toBe(true);
    await expect(
      runWithTxnFlag(async () => {
        assertNoOpenTransaction();
      }),
    ).rejects.toMatchObject({ details: [{ code: 'OUTBOUND_IN_TX' }] });
    const adapter = new SimulatedDigiLockerAdapter();
    const empty = await adapter.fetchVerifiedClaims({
      subject_id: randomUUID(),
      scenario: 'empty',
      test_run_id: 't',
    });
    expect(empty.claims).toEqual([]);
  });
});
