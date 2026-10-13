import { createRetentionApi } from './api/handler.js';
import type { AuthorizationPort } from './authz.js';
import type { ContextResolver } from './context.js';
import { Cmp049Error } from './errors.js';
import { PgRetentionRepository, type SqlPool } from './repo/pg.js';
import type { RetentionRepository } from './repo/types.js';
import { DataRetentionService } from './service/service.js';

export interface DataRetentionOptions {
  pool?: SqlPool;
  repository?: RetentionRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  clock?: () => Date;
}

export function buildDataRetentionService(
  opts: Omit<DataRetentionOptions, 'resolveContext'>,
): DataRetentionService {
  const repo = opts.repository ?? (opts.pool ? new PgRetentionRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp049Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  return new DataRetentionService({
    repo,
    authorizer: opts.authorizer,
    clock: opts.clock ?? ((): Date => new Date()),
  });
}

export function buildDataRetentionApi(
  opts: DataRetentionOptions,
): ReturnType<typeof createRetentionApi> {
  return createRetentionApi({
    service: buildDataRetentionService(opts),
    resolveContext: opts.resolveContext,
  });
}

export { DataRetentionService, ACTIONS } from './service/service.js';
export { createRetentionApi, ROUTE_DESCRIPTORS } from './api/handler.js';
export { PgRetentionRepository } from './repo/pg.js';
export type { SqlClient, SqlPool, SqlResult } from './repo/pg.js';
export {
  ELIGIBILITY_STATES,
  PERIOD_GATED_TARGETS,
  evaluateCandidates,
  evaluateTransition,
  type BlockingReason,
  type Eligibility,
  type EligibilityTransition,
} from './domain/eligibility.js';
export { CONTRACT_ID, toContract, type RetentionPolicyContract } from './domain/policy.js';
export type { AuthorizationPort } from './authz.js';
export type { ContextResolver } from './context.js';
