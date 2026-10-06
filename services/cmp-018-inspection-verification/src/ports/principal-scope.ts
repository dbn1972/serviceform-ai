import type { RequestContext } from '../contracts.js';
import type { ScopeExtension } from '../domain/resolution.js';

export interface PrincipalScopePort {
  extend(ctx: RequestContext): Promise<ScopeExtension>;
}

export const contextOnlyScope: PrincipalScopePort = {
  async extend() {
    return {};
  },
};
