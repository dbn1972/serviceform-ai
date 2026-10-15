import { createSchedulerApi } from './api/handler.js';
import type { AuthorizationPort } from './authz.js';
import type { ContextResolver } from './context.js';
import { Cmp056Error } from './errors.js';
import type { NotificationPort } from './ports/notification.js';
import { PgSchedulerRepository, type SqlPool } from './repo/pg.js';
import type { SchedulerRepository } from './repo/types.js';
import { AppointmentSchedulerService } from './service/service.js';

export interface SchedulerOptions {
  pool?: SqlPool;
  repository?: SchedulerRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  notifier: NotificationPort;
  clock?: () => Date;
}

export function buildSchedulerService(
  opts: Omit<SchedulerOptions, 'resolveContext'>,
): AppointmentSchedulerService {
  const repo = opts.repository ?? (opts.pool ? new PgSchedulerRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp056Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  return new AppointmentSchedulerService({
    repo,
    authorizer: opts.authorizer,
    notifier: opts.notifier,
    clock: opts.clock ?? ((): Date => new Date()),
  });
}

export function buildSchedulerApi(opts: SchedulerOptions): ReturnType<typeof createSchedulerApi> {
  return createSchedulerApi({
    service: buildSchedulerService(opts),
    resolveContext: opts.resolveContext,
  });
}

export { AppointmentSchedulerService, ACTIONS } from './service/service.js';
export { createSchedulerApi, ROUTE_DESCRIPTORS } from './api/handler.js';
export { PgSchedulerRepository } from './repo/pg.js';
export type { SqlClient, SqlPool, SqlResult } from './repo/pg.js';
export {
  CONTRACT_ID,
  CAPACITY_ATOMIC,
  NOTIFICATION_FAILURE_INVALIDATES_BOOKING,
  INVENTED_STATUTORY_POLICY_FORBIDDEN,
  canBook,
  canTransition,
  toContract,
  looksLikeInventedStatutoryCalendar,
} from './domain/appointment.js';
export type { AuthorizationPort } from './authz.js';
export type { ContextResolver } from './context.js';
export type { NotificationPort } from './ports/notification.js';
