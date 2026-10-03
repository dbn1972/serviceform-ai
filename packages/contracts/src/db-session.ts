import type { DbSessionContext, RequestContext } from './types.js';

/**
 * Maps the server-derived request context to the transaction-local settings of
 * SF-CON-DB-SESSION-CONTEXT. Apply each entry with `SELECT set_config($1, $2, true)` inside the
 * transaction, never at session level. A null tenant is omitted, not sent as an empty string.
 */
export function dbSessionSettings(ctx: RequestContext): DbSessionContext {
  return {
    ...(ctx.tenant_id === null ? {} : { 'app.tenant_id': ctx.tenant_id }),
    'app.cell_id': ctx.cell_id,
    'app.actor_type': ctx.actor.type,
    'app.actor_id': ctx.actor.id,
    'app.correlation_id': ctx.correlation_id,
  };
}
