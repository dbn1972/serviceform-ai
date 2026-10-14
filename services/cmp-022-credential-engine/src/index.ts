import { createCredentialApi } from './api/handler.js';
import type { AuthorizationPort } from './authz.js';
import type { ContextResolver } from './context.js';
import type { DeploymentEnvironment } from './domain/signing.js';
import { Cmp022Error } from './errors.js';
import { UnboundCaseIssuancePinsPort, type CaseIssuancePinsPort } from './ports/case-pins-port.js';
import {
  UnboundCredentialRegistryPort,
  type CredentialRegistryPort,
} from './ports/registry-port.js';
import { UnboundArtifactRenderPort, type ArtifactRenderPort } from './ports/render-port.js';
import { UnboundSigningPort, type SigningPort } from './ports/signing-port.js';
import { PgCredentialRepository, type SqlPool } from './repo/pg.js';
import type { CredentialRepository } from './repo/types.js';
import { CredentialService } from './service/service.js';

export interface CredentialOptions {
  pool?: SqlPool;
  repository?: CredentialRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  casePins?: CaseIssuancePinsPort;
  renderer?: ArtifactRenderPort;
  signing?: SigningPort;
  registry?: CredentialRegistryPort;
  /** Defaults to PRODUCTION so that a SIMULATED signing connector is refused unless declared. */
  environment?: DeploymentEnvironment;
  clock?: () => Date;
}

/** Unbound ports fail closed (SF-SYS-004); no default template, signer or registry exists. */
export function buildCredentialService(
  opts: Omit<CredentialOptions, 'resolveContext'>,
): CredentialService {
  const repo = opts.repository ?? (opts.pool ? new PgCredentialRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp022Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  return new CredentialService({
    repo,
    authorizer: opts.authorizer,
    casePins: opts.casePins ?? new UnboundCaseIssuancePinsPort(),
    renderer: opts.renderer ?? new UnboundArtifactRenderPort(),
    signing: opts.signing ?? new UnboundSigningPort(),
    registry: opts.registry ?? new UnboundCredentialRegistryPort(),
    environment: opts.environment ?? 'PRODUCTION',
    clock: opts.clock ?? ((): Date => new Date()),
  });
}

export function buildCredentialApi(
  opts: CredentialOptions,
): ReturnType<typeof createCredentialApi> {
  return createCredentialApi({
    service: buildCredentialService(opts),
    resolveContext: opts.resolveContext,
  });
}

export { CredentialService } from './service/service.js';
export { createCredentialApi, ROUTE_DESCRIPTORS } from './api/handler.js';
export { PgCredentialRepository } from './repo/pg.js';
export { credentialIdFor, credentialView, assertForwardTransition } from './domain/credential.js';
export type { CredentialRow, CredentialView, LifecycleStatus } from './domain/credential.js';
export { validateSigningResult, signingRecordView } from './domain/signing.js';
export type { DeploymentEnvironment, SigningRecordRow } from './domain/signing.js';
export type { SqlClient, SqlPool, SqlResult } from './repo/pg.js';
export type { AuthorizationPort } from './authz.js';
export type { ContextResolver } from './context.js';
export type { CaseIssuancePins, CaseIssuancePinsPort } from './ports/case-pins-port.js';
export type { ArtifactRenderPort, RenderRequest, StoredArtifactRef } from './ports/render-port.js';
export type {
  ConnectorMode,
  SigningAdapterResult,
  SigningPort,
  SigningRequest,
  SimulationMarker,
} from './ports/signing-port.js';
export type {
  CredentialRegistryPort,
  RegistrationAck,
  RegistrationRequest,
} from './ports/registry-port.js';
