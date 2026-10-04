import { describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { authzInput, authorize, denyAllAuthz } from '../../src/authz.js';
import { assertSchemaRegistryModeAllowed, loadConfig } from '../../src/config.js';
import { Cmp033Error } from '../../src/errors.js';
import { validateKindPayload } from '../../src/domain/kinds.js';
import { SimulatedSchemaRegistry } from '../../src/ports/schema-registry.js';
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

describe('cmp-033 unit: modes, kinds, authz', () => {
  it('refuses SIMULATED schema registry in PRODUCTION (INT-013 fail-closed)', () => {
    expect(() => assertSchemaRegistryModeAllowed('SIMULATED', 'PRODUCTION')).toThrow(Cmp033Error);
    expect(() => assertSchemaRegistryModeAllowed('REAL', 'LOCAL')).toThrow(Cmp033Error);
  });

  it('loads default rate limits', () => {
    const cfg = loadConfig({ SF_ENVIRONMENT: 'LOCAL', SF_METADATA_SCHEMA_MODE: 'SIMULATED' });
    expect(cfg.rateLimitMax).toBe(60);
    expect(cfg.schemaRegistryMode).toBe('SIMULATED');
  });

  it('validates structural kind payload without named-service branching', () => {
    expect(() =>
      validateKindPayload('SERVICE', { code: 'generic_service', title: 'Service' }),
    ).not.toThrow();
    expect(() => validateKindPayload('SERVICE', { code: 'Bad', title: 'x' })).toThrow();
  });

  it('builds valid authz input and default deny', async () => {
    const input = authzInput(ctx, 'METADATA_DOCUMENT_CREATE', 'MetadataDocument');
    expect(validate('authz-decision-input', input).valid).toBe(true);
    await expect(authorize(denyAllAuthz(), input)).rejects.toBeInstanceOf(Cmp033Error);
    const allow = new ContractAuthorizer();
    await expect(authorize(allow, input)).resolves.toBeUndefined();
  });

  it('fails closed when PDP throws', async () => {
    const input = authzInput(ctx, 'METADATA_DOCUMENT_READ', 'MetadataDocument');
    const a = new ContractAuthorizer();
    a.throws = true;
    await expect(authorize(a, input)).rejects.toMatchObject({ code: 'SF-SYS-004' });
  });

  it('SIMULATED registry emits SF-CON-SIMULATION-MARKER', async () => {
    const cfg = loadConfig({ SF_ENVIRONMENT: 'LOCAL', SF_METADATA_SCHEMA_MODE: 'SIMULATED' });
    const port = new SimulatedSchemaRegistry(cfg);
    const out = await port.validate({
      kind: 'SERVICE',
      schemaId: 'sf.metadata.kind.service.v1',
      payload: { code: 'generic_service', title: 'Service' },
    });
    expect(out.simulation?.simulation).toBe(true);
    expect(validate('simulation-marker', out.simulation).valid).toBe(true);
  });
});
