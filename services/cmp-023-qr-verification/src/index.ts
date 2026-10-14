import { createQrApi } from './api/handler.js';
import type { AuthorizationPort } from './authz.js';
import type { ContextResolver } from './context.js';
import { Cmp023Error } from './errors.js';
import type { CredentialPort } from './ports/credential-port.js';
import type { RegistryStatusPort } from './ports/registry-status-port.js';
import { PgQrRepository, type SqlPool } from './repo/pg.js';
import type { QrRepository } from './repo/types.js';
import { QrVerificationService } from './service/service.js';

export interface QrVerificationOptions {
  pool?: SqlPool;
  repository?: QrRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  registry: RegistryStatusPort;
  credentials: CredentialPort;
  clock?: () => Date;
}

export function buildQrVerificationService(
  opts: Omit<QrVerificationOptions, 'resolveContext'>,
): QrVerificationService {
  const repo = opts.repository ?? (opts.pool ? new PgQrRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp023Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  return new QrVerificationService({
    repo,
    authorizer: opts.authorizer,
    registry: opts.registry,
    credentials: opts.credentials,
    clock: opts.clock ?? ((): Date => new Date()),
  });
}

export function buildQrVerificationApi(opts: QrVerificationOptions): ReturnType<typeof createQrApi> {
  return createQrApi({
    service: buildQrVerificationService(opts),
    resolveContext: opts.resolveContext,
  });
}

export { QrVerificationService, ACTIONS, TOKEN_RESOURCE_TYPE } from './service/service.js';
export { createQrApi, ROUTE_DESCRIPTORS } from './api/handler.js';
export type { ApiRequest, ApiResponse, RouteDescriptor } from './api/handler.js';
export { PgQrRepository } from './repo/pg.js';
export type { SqlClient, SqlPool, SqlResult } from './repo/pg.js';
export {
  CONTRACT_ID,
  PUBLIC_VIEW_KEYS,
  TOKEN_PURPOSE,
  buildPublicView,
  buildVerificationToken,
  type PublicView,
  type VerificationTokenContract,
} from './domain/token.js';
export type { AuthorizationPort } from './authz.js';
export type { ContextResolver } from './context.js';
export type { CredentialPort, IssuedCredentialView } from './ports/credential-port.js';
export type {
  RegistryStatus,
  RegistryStatusPort,
  RegistryStatusRecord,
} from './ports/registry-status-port.js';
