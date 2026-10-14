import { createRegistryApi } from './api/handler.js';
import type { AuthorizationPort } from './authz.js';
import type { ContextResolver } from './context.js';
import { Cmp024Error } from './errors.js';
import { PgRegistryRepository, type SqlPool } from './repo/pg.js';
import type { RegistryRepository } from './repo/types.js';
import { CredentialRegistryService } from './service/service.js';

export interface CredentialRegistryOptions {
  pool?: SqlPool;
  repository?: RegistryRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  clock?: () => Date;
}

export function buildCredentialRegistryService(
  opts: Omit<CredentialRegistryOptions, 'resolveContext'>,
): CredentialRegistryService {
  const repo = opts.repository ?? (opts.pool ? new PgRegistryRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp024Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  return new CredentialRegistryService({
    repo,
    authorizer: opts.authorizer,
    clock: opts.clock ?? ((): Date => new Date()),
  });
}

export function buildCredentialRegistryApi(
  opts: CredentialRegistryOptions,
): ReturnType<typeof createRegistryApi> {
  return createRegistryApi({
    service: buildCredentialRegistryService(opts),
    resolveContext: opts.resolveContext,
  });
}

export {
  ACTIONS,
  CredentialRegistryService,
  createCredentialStatusReadPort,
  type CredentialStatusReader,
} from './service/service.js';
export { createRegistryApi, ROUTE_DESCRIPTORS, type RouteDescriptor } from './api/handler.js';
export { PgRegistryRepository } from './repo/pg.js';
export type { SqlClient, SqlPool, SqlResult } from './repo/pg.js';
export type { RegistryReadTx, RegistryRepository, RegistryTx } from './repo/types.js';
export {
  COMMAND_SOURCES,
  COMMAND_TARGET,
  CONTRACT_ID,
  REGISTRY_COMMANDS,
  REGISTRY_STATUSES,
  TERMINAL_STATUSES,
  evaluateCommand,
  toContract,
  type CredentialStatusContract,
  type RegistryCommand,
  type RegistryStatus,
} from './domain/status.js';
export { DOMAIN_EVENT_TYPES, TOPIC_AUDIT, TOPIC_DOMAIN } from './outbox.js';
export type { AuthorizationPort } from './authz.js';
export type { ContextResolver } from './context.js';
