import { createSchedulerApi } from './api/handler.js';
import type { AuthorizationPort } from './authz.js';
import type { ContextResolver } from './context.js';
import { Cmp056Error } from './errors.js';
import { PgSchedulerRepository, type SqlPool } from './repo/pg.js';
import type { SchedulerRepository } from './repo/types.js';
import { SchedulerService } from './service/service.js';

export interface SchedulerOptions {
  pool?: SqlPool;
  repository?: SchedulerRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  clock?: () => Date;
}

export function buildSchedulerService(
  opts: Omit<SchedulerOptions, 'resolveContext'>,
): SchedulerService {
  const repo = opts.repository ?? (opts.pool ? new PgSchedulerRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp056Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  return new SchedulerService({
    repo,
    authorizer: opts.authorizer,
    clock: opts.clock ?? ((): Date => new Date()),
  });
}

export function buildSchedulerApi(opts: SchedulerOptions): ReturnType<typeof createSchedulerApi> {
  return createSchedulerApi({
    service: buildSchedulerService(opts),
    resolveContext: opts.resolveContext,
  });
}

export { SchedulerService } from './service/service.js';
export { createSchedulerApi, ROUTE_DESCRIPTORS } from './api/handler.js';
export { PgSchedulerRepository } from './repo/pg.js';
export {
  appointmentView,
  assertTransition,
  canTransition,
  LIFECYCLE_STATUSES,
} from './domain/appointment.js';
export type { AppointmentRow, AppointmentView, LifecycleStatus } from './domain/appointment.js';
export { slotView } from './domain/slot.js';
export type { SlotRow, SlotView } from './domain/slot.js';
export { DOMAIN_EVENT_TYPES, TOPIC_DOMAIN } from './outbox.js';
export type { SqlClient, SqlPool, SqlResult } from './repo/pg.js';
export type { AuthorizationPort } from './authz.js';
export type { ContextResolver } from './context.js';
