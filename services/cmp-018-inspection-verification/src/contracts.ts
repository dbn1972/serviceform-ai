// Shared frozen contracts are consumed from packages/contracts. This component is deliberately a
// dependency-free workspace project (no lockfile change in the builder slice), so the package is
// reached by relative path rather than through a workspace link. STITCH-B may replace this file
// with `export * from '@serviceform/contracts'` once the importer is admitted to the lockfile.
export { dbSessionSettings, errorEntry, validate } from '../../../packages/contracts/src/index.js';
export type {
  Actor,
  AuditEvent,
  AuthzDecisionInput,
  AuthzDecisionOutput,
  EventEnvelope,
  RequestContext,
} from '../../../packages/contracts/src/index.js';
