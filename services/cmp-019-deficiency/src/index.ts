import { PgDeficiencyRepository, type SqlPool } from './repo/pg.js';
import { createDeficiencyApi } from './api/handler.js';
import type { AuthorizationPort } from './authz.js';
import type { ContextResolver } from './context.js';
import { Cmp019Error } from './errors.js';
import { UnboundCaseCommandPort, type CaseCommandPort } from './ports/case-command-port.js';
import { UnboundNotificationPort, type NotificationPort } from './ports/notification-port.js';
import { UnboundSlaClockPort, type SlaClockPort } from './ports/sla-clock-port.js';
import type { DeficiencyRepository } from './repo/types.js';
import { DeficiencyService } from './service/service.js';

export interface DeficiencyOptions {
  pool?: SqlPool;
  repository?: DeficiencyRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  slaClock?: SlaClockPort;
  caseCommands?: CaseCommandPort;
  notifier?: NotificationPort;
  clock?: () => Date;
}

export function buildDeficiencyService(
  opts: Omit<DeficiencyOptions, 'resolveContext'>,
): DeficiencyService {
  const repo = opts.repository ?? (opts.pool ? new PgDeficiencyRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp019Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  return new DeficiencyService({
    repo,
    authorizer: opts.authorizer,
    slaClock: opts.slaClock ?? new UnboundSlaClockPort(),
    caseCommands: opts.caseCommands ?? new UnboundCaseCommandPort(),
    notifier: opts.notifier ?? new UnboundNotificationPort(),
    clock: opts.clock ?? ((): Date => new Date()),
  });
}

export function buildDeficiencyApi(opts: DeficiencyOptions): ReturnType<typeof createDeficiencyApi> {
  return createDeficiencyApi({
    service: buildDeficiencyService(opts),
    resolveContext: opts.resolveContext,
  });
}

export { DeficiencyService } from './service/service.js';
export { createDeficiencyApi, ROUTE_DESCRIPTORS } from './api/handler.js';
export { PgDeficiencyRepository } from './repo/pg.js';
export type { SqlClient, SqlPool, SqlResult } from './repo/pg.js';
export type { SlaClockPort } from './ports/sla-clock-port.js';
export type { CaseCommandPort } from './ports/case-command-port.js';
export type { NotificationPort, DeficiencyNotificationRequest } from './ports/notification-port.js';
export type { AuthorizationPort } from './authz.js';
export type { ContextResolver } from './context.js';
