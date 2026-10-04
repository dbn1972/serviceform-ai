export { Cmp050Error, errorBody } from './errors.js';
export { assertNoTenantIdentifyingHeaders, isForbiddenHeaderName } from './headers.js';
export {
  SESSION_COOKIE,
  assertResourceTenant,
  cookieHeader,
  encodeSessionToken,
  isUuid,
  isRoleCode,
  parseSessionToken,
  sessionFromLogin,
  type LoginInput,
  type PortalSession,
  type PortalSurface,
} from './session.js';
export {
  assertSimulatedSessionAllowed,
  buildPortalSimulationMarker,
  loadPortalConfig,
  parseDeploymentEnvironment,
  type PortalConfig,
} from './config.js';
export {
  METADATA_KINDS,
  defaultFieldValues,
  fieldsForKind,
  isMetadataKind,
  payloadFromFields,
  type FieldHint,
  type MetadataKind,
} from './metadata-kinds.js';
export {
  assertCheckerIsNotMaker,
  makerCheckerUx,
  type MakerCheckerUx,
  type PublicationRequestView,
  type PublicationStatus,
} from './maker-checker-ux.js';
export {
  assertPlatformPath,
  createHttpTransport,
  type PlatformRequest,
  type PlatformResponse,
  type PlatformTransport,
} from './proxy.js';
export { TenantWorkspace, requireTenantMatch } from './workspace.js';
export { createInt002Client, type Int002Client } from './int002-client.js';
export {
  clearSessionResponse,
  createSessionResponse,
  proxyPlatformResponse,
  readSessionResponse,
  cookieValue,
} from './bff-handlers.js';
