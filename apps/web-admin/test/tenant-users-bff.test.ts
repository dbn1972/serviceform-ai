import { describe, expect, it } from 'vitest';
import { assertPlatformPath } from '../lib/bff';

describe('SF-71 admin BFF tenant-users allowlist', () => {
  it('allows tenant-users Admin BFF contract paths', () => {
    expect(assertPlatformPath('admin/tenant-users')).toBe('/v1/admin/tenant-users');
    expect(assertPlatformPath('admin/tenant-users/meta/adapter')).toBe(
      '/v1/admin/tenant-users/meta/adapter',
    );
    expect(assertPlatformPath('admin/tenant-users/meta/roles')).toBe(
      '/v1/admin/tenant-users/meta/roles',
    );
    expect(assertPlatformPath('v1/admin/tenant-users/abc/roles')).toBe(
      '/v1/admin/tenant-users/abc/roles',
    );
  });

  it('refuses unrelated admin paths and prefix overmatch', () => {
    expect(() => assertPlatformPath('admin/secrets')).toThrow(/SF-AUTH-002/);
    expect(() => assertPlatformPath('../admin/tenant-users')).toThrow(/SF-AUTH-002/);
    expect(() => assertPlatformPath('admin/tenant-users-evil')).toThrow(/SF-AUTH-002/);
    expect(() => assertPlatformPath('admin/tenant-usersX')).toThrow(/SF-AUTH-002/);
  });
});
