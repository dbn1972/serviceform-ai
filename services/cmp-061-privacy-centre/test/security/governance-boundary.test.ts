/**
 * Security / tenant-negative / governance boundary tests for CMP-061.
 * - INT-011 tenant isolation (header spoofing + deny-all authz)
 * - SF-CON-PRIVACY-REQUEST: cross_component_direct_mutation_forbidden / owner_task_orchestration_only
 * - No invented privacy statute (opaque refs only)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertNoTenantIdentifyingHeaders } from '../../src/context.js';
import { isOwnerComponent } from '../../src/domain/request.js';
import { Cmp061Error, mapPgError } from '../../src/errors.js';
import { validateSubmitRequest } from '../../src/service/input.js';
import { denyAllAuthorizer } from '../doubles/fixtures.js';

describe('CMP-061 security / governance boundary', () => {
  describe('INT-011: tenant isolation', () => {
    it('rejects tenant-identifying request headers', () => {
      expect(() => assertNoTenantIdentifyingHeaders({ 'x-tenant-id': 't1' })).toThrow(Cmp061Error);
      expect(() => assertNoTenantIdentifyingHeaders({ 'x-sf-tenant': 't1' })).toThrow(Cmp061Error);
      expect(() => assertNoTenantIdentifyingHeaders({ 'x-roles': 'admin' })).toThrow(Cmp061Error);
    });

    it('deny-all authorizer returns allow=false', async () => {
      const out = await denyAllAuthorizer().decide({
        subject: {
          user_id: 'u',
          actor_type: 'CITIZEN',
          tenant_id: 't',
          roles: [],
          jurisdiction_ids: [],
        },
        resource: { resource_type: 'PrivacyRequest', tenant_id: 't' },
        action: 'PRIVACY_REQUEST_SUBMIT',
      });
      expect(out.allow).toBe(false);
    });
  });

  describe('SF-CON-PRIVACY-REQUEST frozen gates', () => {
    it('migration SQL hard-codes both orchestration CHECK constraints', () => {
      const sql = readFileSync(
        join(process.cwd(), '../../db/migrations/1761300000000_cmp-061-privacy-centre.sql'),
        'utf8',
      );
      expect(sql).toContain(
        'cross_component_direct_mutation_forbidden boolean NOT NULL DEFAULT true',
      );
      expect(sql).toContain('CHECK (cross_component_direct_mutation_forbidden)');
      expect(sql).toContain('owner_task_orchestration_only boolean NOT NULL DEFAULT true');
      expect(sql).toContain('CHECK (owner_task_orchestration_only)');
      expect(sql).toContain('invented_statutory_policy_forbidden boolean NOT NULL DEFAULT true');
      expect(sql).toContain('FORCE ROW LEVEL SECURITY');
      expect(sql).toContain("owner_component <> 'CMP-061'");
    });

    it('self-component cannot be an owner (blocks self-as-cross-SQL target)', () => {
      expect(isOwnerComponent('CMP-061')).toBe(false);
    });

    it('submit validation refuses flipping frozen markers to false', () => {
      expect(() =>
        validateSubmitRequest({
          request_type: 'ACCESS',
          scope: [{ owner_component: 'CMP-030', scope_ref: 'ok' }],
          owner_task_orchestration_only: false,
        }),
      ).toThrow();
    });
  });

  describe('error mapping', () => {
    it('maps RLS privilege failure to SF-TEN-002', () => {
      expect(mapPgError(Object.assign(new Error('rls'), { code: '42501' })).code).toBe(
        'SF-TEN-002',
      );
    });

    it('maps check violations to SF-SYS-003', () => {
      expect(mapPgError(Object.assign(new Error('check'), { code: '23514' })).code).toBe(
        'SF-SYS-003',
      );
    });
  });
});
