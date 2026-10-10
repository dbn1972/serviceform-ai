import { createOpsDashboardApi } from './api/handler.js';
import type { AuthorizationPort } from './authz.js';
import type { ContextResolver } from './context.js';
import { VIEW_CODES, type ViewCode } from './domain/model.js';
import { Cmp046Error } from './errors.js';
import { UnboundSummaryPort, type SummaryPort, type SummaryPorts } from './ports/summary-port.js';
import { PgOpsRepository, type SqlPool } from './repo/pg.js';
import type { OpsRepository } from './repo/types.js';
import { OperationalDashboardService } from './service/service.js';

export interface OpsDashboardOptions {
  pool?: SqlPool;
  repository?: OpsRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  /** Owner-component adapters keyed by view; any view left out is reported UNAVAILABLE. */
  ports?: Partial<Record<ViewCode, SummaryPort>>;
  clock?: () => Date;
  portTimeoutMs?: number;
}

export function bindPorts(partial: Partial<Record<ViewCode, SummaryPort>> = {}): SummaryPorts {
  const entries = VIEW_CODES.map((code) => [code, partial[code] ?? new UnboundSummaryPort(code)]);
  return Object.fromEntries(entries) as SummaryPorts;
}

export function buildOpsDashboardService(
  opts: Omit<OpsDashboardOptions, 'resolveContext'>,
): OperationalDashboardService {
  const repo = opts.repository ?? (opts.pool ? new PgOpsRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp046Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  return new OperationalDashboardService({
    repo,
    authorizer: opts.authorizer,
    ports: bindPorts(opts.ports),
    clock: opts.clock ?? ((): Date => new Date()),
    ...(opts.portTimeoutMs === undefined ? {} : { portTimeoutMs: opts.portTimeoutMs }),
  });
}

export function buildOpsDashboardApi(
  opts: OpsDashboardOptions,
): ReturnType<typeof createOpsDashboardApi> {
  return createOpsDashboardApi({
    service: buildOpsDashboardService(opts),
    resolveContext: opts.resolveContext,
  });
}

export { OperationalDashboardService } from './service/service.js';
export { createOpsDashboardApi, ROUTE_DESCRIPTORS } from './api/handler.js';
export { PgOpsRepository } from './repo/pg.js';
export type { SqlClient, SqlPool, SqlResult } from './repo/pg.js';
export {
  VIEW_CODES,
  VIEW_DEFINITIONS,
  normalizeSample,
  type PortSample,
  type ViewCode,
} from './domain/model.js';
export type {
  SummaryPort,
  SlaSummaryPort,
  WorkQueueSummaryPort,
  IntegrationHealthPort,
  EventHealthPort,
  PlatformHealthPort,
} from './ports/summary-port.js';
export type { AuthorizationPort } from './authz.js';
export type { ContextResolver } from './context.js';
