import type { RequestContext } from '../../src/contracts.js';
import type { ScopeExtension } from '../../src/domain/resolution.js';
import type { PrincipalScopePort } from '../../src/ports/principal-scope.js';

export class ScriptedScope implements PrincipalScopePort {
  byActor = new Map<string, ScopeExtension>();

  async extend(ctx: RequestContext): Promise<ScopeExtension> {
    return this.byActor.get(ctx.actor.id) ?? {};
  }
}
