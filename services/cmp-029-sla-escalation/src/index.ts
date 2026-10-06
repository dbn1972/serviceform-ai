import { PgSlaRepository, type SqlPool } from './repo/pg.js';
import { createSlaApi } from './api/handler.js';
import type { AuthorizationPort } from './authz.js';
import type { ContextResolver } from './context.js';
import type { SlaNotificationPort } from './ports/notification-port.js';
import { UnboundNotificationPort } from './ports/notification-port.js';
import type { SlaRepository } from './repo/types.js';
import { SlaService } from './service/sla-service.js';
import { Cmp029Error } from './errors.js';

export interface SlaEscalationOptions {
  pool?: SqlPool;
  repository?: SlaRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  notifier?: SlaNotificationPort;
  /** Defaults to the process wall clock. Never overridable from a request. */
  clock?: () => Date;
}

export function buildSlaService(opts: Omit<SlaEscalationOptions, 'resolveContext'>): SlaService {
  const repo = opts.repository ?? (opts.pool ? new PgSlaRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp029Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  return new SlaService({
    repo,
    authorizer: opts.authorizer,
    notifier: opts.notifier ?? new UnboundNotificationPort(),
    clock: opts.clock ?? ((): Date => new Date()),
  });
}

export function buildSlaApi(opts: SlaEscalationOptions): ReturnType<typeof createSlaApi> {
  return createSlaApi({ service: buildSlaService(opts), resolveContext: opts.resolveContext });
}

export { SlaService } from './service/sla-service.js';
export { createSlaApi, ROUTE_DESCRIPTORS } from './api/handler.js';
export { PgSlaRepository } from './repo/pg.js';
export type { SqlClient, SqlPool, SqlResult } from './repo/pg.js';
export type { DeficiencyClockPort } from './ports/deficiency-clock-port.js';
export type { SlaNotificationPort, SlaNotificationRequest } from './ports/notification-port.js';
export type { AuthorizationPort } from './authz.js';
export type { ContextResolver } from './context.js';
