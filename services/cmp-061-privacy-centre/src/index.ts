import { createPrivacyApi } from './api/handler.js';
import type { AuthorizationPort } from './authz.js';
import type { ContextResolver } from './context.js';
import { Cmp061Error } from './errors.js';
import { PgPrivacyRepository, type SqlPool } from './repo/pg.js';
import type { PrivacyRepository } from './repo/types.js';
import { PrivacyCentreService } from './service/service.js';

export interface PrivacyCentreOptions {
  pool?: SqlPool;
  repository?: PrivacyRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  clock?: () => Date;
}

export function buildPrivacyCentreService(
  opts: Omit<PrivacyCentreOptions, 'resolveContext'>,
): PrivacyCentreService {
  const repo = opts.repository ?? (opts.pool ? new PgPrivacyRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp061Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  return new PrivacyCentreService({
    repo,
    authorizer: opts.authorizer,
    clock: opts.clock ?? ((): Date => new Date()),
  });
}

export function buildPrivacyCentreApi(
  opts: PrivacyCentreOptions,
): ReturnType<typeof createPrivacyApi> {
  return createPrivacyApi({
    service: buildPrivacyCentreService(opts),
    resolveContext: opts.resolveContext,
  });
}

export { PrivacyCentreService, ACTIONS } from './service/service.js';
export { createPrivacyApi, ROUTE_DESCRIPTORS } from './api/handler.js';
export { PgPrivacyRepository } from './repo/pg.js';
export type { SqlClient, SqlPool, SqlResult } from './repo/pg.js';
export {
  CONTRACT_ID,
  toContract,
  canTransition,
  allOwnerOutcomesReceived,
  type PrivacyRequestContract,
  type LifecycleStatus,
  type RequestType,
} from './domain/request.js';
export type { AuthorizationPort } from './authz.js';
export type { ContextResolver } from './context.js';
