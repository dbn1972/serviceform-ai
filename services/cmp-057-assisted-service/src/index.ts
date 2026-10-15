import { createAssistedApi } from './api/handler.js';
import type { AuthorizationPort } from './authz.js';
import type { ContextResolver } from './context.js';
import { Cmp057Error } from './errors.js';
import { PgAssistedRepository, type SqlPool } from './repo/pg.js';
import type { AssistedRepository } from './repo/types.js';
import { AssistedSessionService } from './service/service.js';
import type { AssistedVerificationPort } from './verification.js';

export interface AssistedServiceOptions {
  pool?: SqlPool;
  repository?: AssistedRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  verification: AssistedVerificationPort;
  clock?: () => Date;
  handoffTtlMs?: number;
}

export function buildAssistedSessionService(
  opts: Omit<AssistedServiceOptions, 'resolveContext'>,
): AssistedSessionService {
  const repo = opts.repository ?? (opts.pool ? new PgAssistedRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp057Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  return new AssistedSessionService({
    repo,
    authorizer: opts.authorizer,
    verification: opts.verification,
    clock: opts.clock ?? ((): Date => new Date()),
    ...(opts.handoffTtlMs === undefined ? {} : { handoffTtlMs: opts.handoffTtlMs }),
  });
}

export function buildAssistedApi(
  opts: AssistedServiceOptions,
): ReturnType<typeof createAssistedApi> {
  return createAssistedApi({
    service: buildAssistedSessionService(opts),
    resolveContext: opts.resolveContext,
  });
}

export {
  AssistedSessionService,
  ACTIONS,
  RESOURCE_TYPE,
  createAssistedSessionReadPort,
  canView,
  sessionView,
} from './service/service.js';
export { createAssistedApi, ROUTE_DESCRIPTORS } from './api/handler.js';
export { PgAssistedRepository } from './repo/pg.js';
export type { SqlClient, SqlPool, SqlResult } from './repo/pg.js';
export {
  CONTRACT_ID,
  CHANNELS,
  LIFECYCLE_STATUSES,
  evaluateCommand,
  requiresRepresentation,
  toContract,
  type AssistedSessionContract,
  type Channel,
  type LifecycleStatus,
} from './domain/session.js';
export type { AuthorizationPort } from './authz.js';
export type { ContextResolver } from './context.js';
export type { AssistedVerificationPort } from './verification.js';
