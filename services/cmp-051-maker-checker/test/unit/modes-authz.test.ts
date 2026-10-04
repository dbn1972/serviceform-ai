import { describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { authzInput, authorize, denyAllAuthz } from '../../src/authz.js';
import { assertConnectorModeAllowed, loadConfig } from '../../src/config.js';
import { Cmp051Error } from '../../src/errors.js';
import { OffAiValidationPort } from '../../src/ports/ai-validation.js';
import { SimulatedMetadataPort } from '../../src/ports/metadata.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';

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

describe('cmp-051 unit: modes and authz', () => {
  it('refuses SIMULATED connectors in PRODUCTION (INT-013 fail-closed)', () => {
    expect(() => assertConnectorModeAllowed('SIMULATED', 'PRODUCTION', 'METADATA')).toThrow(
      Cmp051Error,
    );
    expect(() =>
      loadConfig({ SF_ENVIRONMENT: 'PRODUCTION', SF_CMP051_METADATA_MODE: 'SIMULATED' }),
    ).toThrow(Cmp051Error);
  });

  it('loads OFF AI mode by default so CMP-043 cannot block', () => {
    const cfg = loadConfig({ SF_ENVIRONMENT: 'LOCAL', SF_CMP051_METADATA_MODE: 'SIMULATED' });
    expect(cfg.aiMode).toBe('OFF');
  });

  it('builds valid authz input and default deny', async () => {
    const input = authzInput(ctx, 'PUBLICATION_REQUEST_CREATE', 'PublicationRequest');
    expect(validate('authz-decision-input', input).valid).toBe(true);
    await expect(authorize(denyAllAuthz(), input)).rejects.toBeInstanceOf(Cmp051Error);
    await expect(authorize(new ContractAuthorizer(), input)).resolves.toBeUndefined();
  });

  it('fails closed when PDP throws', async () => {
    const a = new ContractAuthorizer();
    a.throws = true;
    await expect(
      authorize(a, authzInput(ctx, 'PUBLICATION_REQUEST_READ', 'PublicationRequest')),
    ).rejects.toMatchObject({ code: 'SF-SYS-004' });
  });

  it('SIMULATED metadata emits SF-CON-SIMULATION-MARKER', async () => {
    const cfg = loadConfig({ SF_ENVIRONMENT: 'LOCAL', SF_CMP051_METADATA_MODE: 'SIMULATED' });
    const out = await new SimulatedMetadataPort(cfg).assertPublishable({
      proposedHash: `sha256:${'ab'.repeat(32)}`,
    });
    expect(out.simulation?.simulation).toBe(true);
    expect(validate('simulation-marker', out.simulation).valid).toBe(true);
  });

  it('AI review never reports blocking', async () => {
    const out = await new OffAiValidationPort().review({
      requestId: '22222222-2222-4222-8222-222222222222',
      proposedHash: `sha256:${'ab'.repeat(32)}`,
    });
    expect(out.blocking).toBe(false);
  });
});
