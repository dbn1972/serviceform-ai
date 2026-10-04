import { describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { authzInput, authorize, denyAllAuthz } from '../../src/authz.js';
import { assertConnectorModeAllowed } from '../../src/config.js';
import { artifactHash, parsePins } from '../../src/domain/pins.js';
import { Cmp052Error } from '../../src/errors.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { validPins } from '../fixtures/pins.js';

const ctx = {
  tenant_id: '11111111-1111-4111-8111-111111111111',
  actor: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', type: 'OFFICER' as const },
  roles: ['SERVICE_DESIGNER'],
  jurisdiction_ids: [] as string[],
  auth_assurance: 'MFA' as const,
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  cell_id: 'cell-01',
  trace_id: '0af7651916cd43dd8448eb211c80319c',
};

describe('cmp-052 unit: pins, modes, authz', () => {
  it('refuses SIMULATED approval connector in PRODUCTION (INT-013 fail-closed)', () => {
    expect(() => assertConnectorModeAllowed('SIMULATED', 'PRODUCTION', 'APPROVAL')).toThrow(
      Cmp052Error,
    );
  });

  it('computes a stable artifact hash for the same pins', () => {
    const pins = parsePins(validPins());
    const a = artifactHash({
      binding_key: 'generic.offering',
      offering_ref: 'offering-ref',
      metadata_bundle_ref: 'bundle-ref',
      pins,
    });
    const b = artifactHash({
      binding_key: 'generic.offering',
      offering_ref: 'offering-ref',
      metadata_bundle_ref: 'bundle-ref',
      pins,
    });
    expect(a).toBe(b);
    expect(a.startsWith('sha256:')).toBe(true);
  });

  it('rejects incomplete pin maps', () => {
    expect(() =>
      parsePins({ form: { version_ref: 'x', content_hash: `sha256:${'ab'.repeat(32)}` } }),
    ).toThrow(Cmp052Error);
  });

  it('builds valid authz input and default deny', async () => {
    const input = authzInput(ctx, 'TENANT_SERVICE_BINDING_PUBLISH', 'TenantServiceBinding');
    expect(validate('authz-decision-input', input).valid).toBe(true);
    await expect(authorize(denyAllAuthz(), input)).rejects.toBeInstanceOf(Cmp052Error);
    await expect(authorize(new ContractAuthorizer(), input)).resolves.toBeUndefined();
  });
});
