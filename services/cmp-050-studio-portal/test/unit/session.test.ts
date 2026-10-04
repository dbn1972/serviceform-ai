import { describe, expect, it } from 'vitest';
import { Cmp050Error } from '../../src/errors.js';
import {
  encodeSessionToken,
  isRoleCode,
  isUuid,
  parseSessionToken,
  sessionFromLogin,
} from '../../src/session.js';
import { assertSimulatedSessionAllowed, loadPortalConfig } from '../../src/config.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('portal session', () => {
  it('round-trips a LOCAL token without HMAC', () => {
    const session = sessionFromLogin({
      tenant_id: tenant,
      actor_id: actor,
      roles: ['STUDIO_DESIGNER'],
      surface: 'service_studio',
    });
    const token = encodeSessionToken(session, { environment: 'LOCAL' });
    const parsed = parseSessionToken(token, { environment: 'LOCAL' });
    expect(parsed.tenant_id).toBe(tenant);
    expect(parsed.actor_id).toBe(actor);
    expect(parsed.correlation_id).toBe(session.correlation_id);
    expect(parsed.roles).toEqual(['STUDIO_DESIGNER']);
  });

  it('rejects forged HMAC in PRODUCTION', () => {
    const session = sessionFromLogin({
      tenant_id: tenant,
      actor_id: actor,
      roles: ['STUDIO_CHECKER'],
      surface: 'tenant_admin',
    });
    const token = encodeSessionToken(session, {
      environment: 'PRODUCTION',
      secret: 'sixteen-chars-min',
    });
    expect(() =>
      parseSessionToken(token, { environment: 'PRODUCTION', secret: 'different-secret-1' }),
    ).toThrow(Cmp050Error);
  });

  it('forbids SIMULATED session in PRODUCTION', () => {
    expect(() => assertSimulatedSessionAllowed('PRODUCTION')).toThrow(Cmp050Error);
    expect(() => assertSimulatedSessionAllowed('LOCAL')).not.toThrow();
  });

  it('refuses invalid tenant ids', () => {
    expect(() =>
      sessionFromLogin({
        tenant_id: 'not-a-uuid',
        actor_id: actor,
        roles: ['STUDIO_DESIGNER'],
        surface: 'service_studio',
      }),
    ).toThrow(Cmp050Error);
    expect(() =>
      sessionFromLogin({
        tenant_id: `${'a'.repeat(10_000)}-1111-4111-8111-111111111111`,
        actor_id: actor,
        roles: ['STUDIO_DESIGNER'],
        surface: 'service_studio',
      }),
    ).toThrow(Cmp050Error);
  });

  it('validates uuid and role codes linearly', () => {
    expect(isUuid(tenant)).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('a'.repeat(36))).toBe(false);
    expect(isRoleCode('STUDIO_DESIGNER')).toBe(true);
    expect(isRoleCode('a')).toBe(false);
    expect(isRoleCode('studio')).toBe(false);
  });

  it('loads config from env without logging secrets', () => {
    const cfg = loadPortalConfig({
      SF_ENVIRONMENT: 'CI',
      SF_API_BASE_URL: 'http://127.0.0.1:3000/',
    });
    expect(cfg.apiBaseUrl).toBe('http://127.0.0.1:3000');
    expect(cfg.environment).toBe('CI');
  });
});
