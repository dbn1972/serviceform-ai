import { createDiscoveryApi } from './api/handler.js';
import type { AuthorizationPort } from './authz.js';
import type { ContextResolver } from './context.js';
import { Cmp006Error } from './errors.js';
import type { CataloguePort } from './ports/catalogue-port.js';
import type { JurisdictionPort } from './ports/jurisdiction-port.js';
import type { LocalizationPort } from './ports/localization-port.js';
import type { SearchPort } from './ports/search-port.js';
import { PgDiscoveryRepository, type SqlPool } from './repo/pg.js';
import type { DiscoveryRepository } from './repo/types.js';
import { ServiceDiscoveryService } from './service/service.js';

export interface ServiceDiscoveryOptions {
  pool?: SqlPool;
  repository?: DiscoveryRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  catalogue: CataloguePort;
  jurisdictions: JurisdictionPort;
  search: SearchPort;
  localization?: LocalizationPort;
  clock?: () => Date;
}

export function buildServiceDiscoveryService(
  opts: Omit<ServiceDiscoveryOptions, 'resolveContext'>,
): ServiceDiscoveryService {
  const repo = opts.repository ?? (opts.pool ? new PgDiscoveryRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp006Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  return new ServiceDiscoveryService({
    repo,
    authorizer: opts.authorizer,
    catalogue: opts.catalogue,
    jurisdictions: opts.jurisdictions,
    search: opts.search,
    ...(opts.localization ? { localization: opts.localization } : {}),
    clock: opts.clock ?? ((): Date => new Date()),
  });
}

export function buildServiceDiscoveryApi(
  opts: ServiceDiscoveryOptions,
): ReturnType<typeof createDiscoveryApi> {
  return createDiscoveryApi({
    service: buildServiceDiscoveryService(opts),
    resolveContext: opts.resolveContext,
  });
}

export { ServiceDiscoveryService, ACTIONS } from './service/service.js';
export { createDiscoveryApi, ROUTE_DESCRIPTORS } from './api/handler.js';
export { PgDiscoveryRepository } from './repo/pg.js';
export type { SqlClient, SqlPool, SqlResult } from './repo/pg.js';
export {
  CONTRACT_ID,
  buildDiscoveryQuery,
  isDiscoveryQuery,
  type DiscoveryQueryContract,
} from './domain/query.js';
export {
  applicableJurisdictions,
  assertPublishedPin,
  selectAvailable,
  type DiscoveryResultItem,
} from './domain/availability.js';
export type { AuthorizationPort } from './authz.js';
export type { ContextResolver } from './context.js';
export type { CatalogueEntry, CataloguePort, CatalogueVersionPin } from './ports/catalogue-port.js';
export type { JurisdictionPort, JurisdictionResolution } from './ports/jurisdiction-port.js';
export type { LocalizationPort } from './ports/localization-port.js';
export type { SearchCandidate, SearchPort } from './ports/search-port.js';
