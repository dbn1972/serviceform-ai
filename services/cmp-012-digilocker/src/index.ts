import { createDigilockerApi } from './api/handler.js';
import type { AuthorizationPort } from './authz.js';
import type { ContextResolver } from './context.js';
import { Cmp012Error } from './errors.js';
import {
  UnboundConnectorBindingPort,
  type ConnectorBindingPort,
} from './ports/connector-binding-port.js';
import type { DigiLockerApiPort } from './ports/digilocker-api-port.js';
import type { DigilockerRepository } from './repo/types.js';
import { DigiLockerService } from './service/service.js';
import type { DeploymentEnvironment } from './types.js';

export interface DigilockerOptions {
  repository?: DigilockerRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  connectorBinding?: ConnectorBindingPort;
  digilockerApi?: DigiLockerApiPort;
  runtimeEnvironment?: DeploymentEnvironment;
  clock?: () => Date;
}

export function buildDigiLockerService(
  opts: Omit<DigilockerOptions, 'resolveContext'>,
): DigiLockerService {
  if (!opts.repository) {
    throw new Cmp012Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  }
  if (!opts.digilockerApi) {
    throw new Cmp012Error('SF-SYS-001', { details: [{ code: 'DIGILOCKER_API_REQUIRED' }] });
  }
  return new DigiLockerService({
    repo: opts.repository,
    authorizer: opts.authorizer,
    connectorBinding: opts.connectorBinding ?? new UnboundConnectorBindingPort(),
    digilockerApi: opts.digilockerApi,
    runtimeEnvironment: opts.runtimeEnvironment ?? 'LOCAL',
    clock: opts.clock ?? ((): Date => new Date()),
  });
}

export function buildDigilockerApi(
  opts: DigilockerOptions,
): ReturnType<typeof createDigilockerApi> {
  return createDigilockerApi({
    service: buildDigiLockerService(opts),
    resolveContext: opts.resolveContext,
  });
}

export { DigiLockerService } from './service/service.js';
export { createDigilockerApi, ROUTE_DESCRIPTORS } from './api/handler.js';
export { SimulatedDigiLockerConnector } from './connectors/simulated-digilocker.js';
export type {
  DigiLockerApiPort,
  DigiLockerPublishRequest,
  DigiLockerPublishResult,
} from './ports/digilocker-api-port.js';
export type { ConnectorBindingPort } from './ports/connector-binding-port.js';
export type { DigilockerRepository, PublishRow } from './repo/types.js';
export type { AuthorizationPort } from './authz.js';
export type { ContextResolver } from './context.js';
export type { ConnectorBindingView, SimulationMarker } from './domain/simulation.js';
