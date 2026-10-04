import { Cmp050Error } from './errors.js';
import type { PortalSession } from './session.js';
import { assertResourceTenant } from './session.js';

/**
 * Session-scoped bag. Keys never leak across tenants (INT-011, CROSS_TENANT_LEAKAGE=0).
 */
export class TenantWorkspace<T> {
  readonly #bags = new Map<string, Map<string, T>>();

  bag(session: PortalSession): Map<string, T> {
    let inner = this.#bags.get(session.tenant_id);
    if (!inner) {
      inner = new Map();
      this.#bags.set(session.tenant_id, inner);
    }
    return inner;
  }

  get(session: PortalSession, key: string): T | undefined {
    return this.#bags.get(session.tenant_id)?.get(key);
  }

  set(session: PortalSession, key: string, value: T): void {
    this.bag(session).set(key, value);
  }

  snapshot(session: PortalSession): ReadonlyMap<string, T> {
    return new Map(this.#bags.get(session.tenant_id) ?? []);
  }

  assertNoCrossTenantLeakage(tenantA: string, tenantB: string): void {
    if (tenantA === tenantB)
      throw new Cmp050Error('SF-SYS-003', { details: [{ code: 'SAME_TENANT' }] });
    const a = this.#bags.get(tenantA);
    const b = this.#bags.get(tenantB);
    if (!a || !b) return;
    if (a === b) {
      throw new Cmp050Error('SF-TEN-002', { details: [{ code: 'CROSS_TENANT_LEAKAGE' }] });
    }
    for (const value of a.values()) {
      if (typeof value !== 'object' || value === null) continue;
      for (const other of b.values()) {
        if (value === other) {
          throw new Cmp050Error('SF-TEN-002', { details: [{ code: 'CROSS_TENANT_LEAKAGE' }] });
        }
      }
    }
  }
}

export function requireTenantMatch(
  session: PortalSession,
  resourceTenantId: string | undefined,
): void {
  if (resourceTenantId === undefined) return;
  assertResourceTenant(session, resourceTenantId);
}
