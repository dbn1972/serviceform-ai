import type { RequestContext } from '../contracts.js';
import type { ScopeExtension } from '../domain/resolution.js';

/**
 * Reads what a principal covers beyond the request context (jurisdiction descendants, offices,
 * service scopes) from the owning components' published APIs. CMP-017 never reads their tables.
 */
export interface PrincipalScopePort {
  extend(ctx: RequestContext): Promise<ScopeExtension>;
}

/** Default: the request context alone defines the principal's coverage. */
export const contextOnlyScope: PrincipalScopePort = {
  async extend() {
    return {};
  },
};
