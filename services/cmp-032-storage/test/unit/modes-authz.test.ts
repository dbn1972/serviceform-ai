import { describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { assertStorageModeAllowed } from '@serviceform/storage';
import { authzInput, authorize, denyAllAuthz } from '../../src/authz.js';
import { loadConfig } from '../../src/config.js';
import { Cmp032Error } from '../../src/errors.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';

const ctx = {
  tenant_id: '11111111-1111-4111-8111-111111111111',
  actor: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', type: 'OFFICER' as const },
  roles: ['SERVICE_CHECKER'],
  jurisdiction_ids: [] as string[],
  auth_assurance: 'MFA' as const,
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  cell_id: 'cell-01',
  trace_id: '0af7651916cd43dd8448eb211c80319c',
};

describe('cmp-032 unit: modes and authz', () => {
  it('refuses REAL storage mode', () => {
    expect(() => assertStorageModeAllowed('REAL', 'LOCAL')).toThrow();
  });

  it('loads default rate limits', () => {
    const cfg = loadConfig({ SF_ENVIRONMENT: 'LOCAL', SF_STORAGE_MODE: 'SIMULATED' });
    expect(cfg.rateLimitMax).toBe(60);
    expect(cfg.rateLimitWindowMs).toBe(60_000);
  });

  it('builds valid authz input and default deny', async () => {
    const input = authzInput(ctx, 'STORAGE_OBJECT_CREATE', 'StorageObject');
    expect(validate('authz-decision-input', input).valid).toBe(true);
    await expect(authorize(denyAllAuthz(), input)).rejects.toBeInstanceOf(Cmp032Error);
    const allow = new ContractAuthorizer();
    await expect(authorize(allow, input)).resolves.toBeUndefined();
  });

  it('fails closed when PDP throws', async () => {
    const input = authzInput(ctx, 'STORAGE_OBJECT_ACCESS', 'StorageObject');
    const a = new ContractAuthorizer();
    a.throws = true;
    await expect(authorize(a, input)).rejects.toMatchObject({ code: 'SF-SYS-004' });
  });
});
