import { describe, expect, it } from 'vitest';
import {
  assertConnectorModeAllowed,
  loadConfig,
  parseDeploymentEnvironment,
} from '../../src/config.js';
import { Cmp009Error } from '../../src/errors.js';
import { isForbiddenHeaderName, requireContext } from '../../src/context.js';
import { mapPgError } from '../../src/errors.js';
import { denyAllAuthz, authorize, authzInput } from '../../src/authz.js';
import { IdentityLocalizationPort } from '../../src/ports/localization.js';
import { DenyFormDefinitionPort } from '../../src/ports/form-definition.js';

describe('config and ports', () => {
  it('refuses SIMULATED in PRODUCTION and REAL form sources', () => {
    expect(() => parseDeploymentEnvironment('NOPE')).toThrow(Cmp009Error);
    expect(() => assertConnectorModeAllowed('REAL', 'LOCAL', 'FORM_SOURCE')).toThrow(Cmp009Error);
    expect(() => assertConnectorModeAllowed('SIMULATED', 'PRODUCTION', 'FORM_SOURCE')).toThrow(
      Cmp009Error,
    );
    expect(() =>
      loadConfig({ SF_ENVIRONMENT: 'PRODUCTION', SF_CMP009_FORM_SOURCE_MODE: 'SIMULATED' }),
    ).toThrow(Cmp009Error);
    const cfg = loadConfig({
      SF_ENVIRONMENT: 'LOCAL',
      SF_CMP009_FORM_SOURCE_MODE: 'SIMULATED',
      SF_CMP009_LOCALIZATION_MODE: 'SIMULATED',
    });
    expect(cfg.formSourceMode).toBe('SIMULATED');
  });

  it('denies forged tenant-identifying headers and missing context', () => {
    expect(isForbiddenHeaderName('x-tenant-id')).toBe(true);
    expect(isForbiddenHeaderName('x-sf-cell')).toBe(true);
    expect(() => requireContext(null)).toThrow(Cmp009Error);
    expect(mapPgError({ code: '42501' }).code).toBe('SF-TEN-002');
    expect(mapPgError({ code: 'P0001', hint: 'SF_RECORD_IMMUTABLE' }).details?.[0]?.code).toBe(
      'RECORD_IMMUTABLE',
    );
  });

  it('authorization fail-closes', async () => {
    await expect(
      authorize(
        denyAllAuthz(),
        authzInput(
          {
            tenant_id: '11111111-1111-4111-8111-111111111111',
            actor: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', type: 'OFFICER' },
            roles: ['CASE_OFFICER'],
            jurisdiction_ids: [],
            correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
            cell_id: 'cell-01',
            trace_id: '0af7651916cd43dd8448eb211c80319c',
          },
          'FORM_EXECUTION_EXECUTE',
          'FormExecution',
        ),
      ),
    ).rejects.toThrow(Cmp009Error);
  });

  it('identity localization echoes keys and deny form port fails closed', async () => {
    const loc = new IdentityLocalizationPort();
    const out = await loc.resolve({
      tenantId: '11111111-1111-4111-8111-111111111111',
      locale: 'en',
      keys: ['form.field.given_name'],
      correlationId: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
    });
    expect(out.messages['form.field.given_name']).toBe('form.field.given_name');
    await expect(
      new DenyFormDefinitionPort().resolve({
        tenantId: '11111111-1111-4111-8111-111111111111',
        formKey: 'generic.intake-form',
        versionId: '44444444-4444-4444-8444-444444444444',
        contentHash: `sha256:${'ab'.repeat(32)}`,
        correlationId: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
      }),
    ).rejects.toThrow(Cmp009Error);
  });
});
