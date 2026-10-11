import { createAnalyticsApi } from './api/handler.js';
import type { AuthorizationPort } from './authz.js';
import type { ContextResolver } from './context.js';
import { Cmp045Error } from './errors.js';
import { UnboundReplayPort, type EventReplayPort } from './ports/replay-port.js';
import { PgAnalyticsRepository, type SqlPool } from './repo/pg.js';
import type { AnalyticsRepository } from './repo/types.js';
import { AnalyticsService } from './service/analytics-service.js';

export interface AnalyticsOptions {
  pool?: SqlPool;
  repository?: AnalyticsRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  /** Workload identity of the event consumer; the host supplies it from the CMP-038 subscription. */
  consumerActorId: string;
  replay?: EventReplayPort;
  /** Defaults to the process wall clock. Never overridable from a request. */
  clock?: () => Date;
  maxFutureSkewMs?: number;
  rebuildBatchSize?: number;
  maxRebuildBatches?: number;
  rebuildLeaseMs?: number;
}

export function buildAnalyticsService(
  opts: Omit<AnalyticsOptions, 'resolveContext'>,
): AnalyticsService {
  const repo = opts.repository ?? (opts.pool ? new PgAnalyticsRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp045Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  return new AnalyticsService({
    repo,
    authorizer: opts.authorizer,
    replay: opts.replay ?? new UnboundReplayPort(),
    clock: opts.clock ?? ((): Date => new Date()),
    consumerActorId: opts.consumerActorId,
    ...(opts.maxFutureSkewMs === undefined ? {} : { maxFutureSkewMs: opts.maxFutureSkewMs }),
    ...(opts.rebuildBatchSize === undefined ? {} : { rebuildBatchSize: opts.rebuildBatchSize }),
    ...(opts.maxRebuildBatches === undefined ? {} : { maxRebuildBatches: opts.maxRebuildBatches }),
    ...(opts.rebuildLeaseMs === undefined ? {} : { rebuildLeaseMs: opts.rebuildLeaseMs }),
  });
}

export function buildAnalyticsApi(opts: AnalyticsOptions): ReturnType<typeof createAnalyticsApi> {
  return createAnalyticsApi({
    service: buildAnalyticsService(opts),
    resolveContext: opts.resolveContext,
  });
}

export { AnalyticsService } from './service/analytics-service.js';
export type { IngestResult } from './service/analytics-service.js';
export { createAnalyticsApi, ROUTE_DESCRIPTORS } from './api/handler.js';
export { PgAnalyticsRepository } from './repo/pg.js';
export type { SqlClient, SqlPool, SqlResult } from './repo/pg.js';
export type { EventReplayPort, ReplayBatch, ReplayRequest } from './ports/replay-port.js';
export type { AuthorizationPort } from './authz.js';
export type { ContextResolver } from './context.js';
