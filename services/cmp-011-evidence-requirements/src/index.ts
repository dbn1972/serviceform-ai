export {
  registerEvidence,
  evidencePlugin,
  authorize,
  denyAllAuthz,
  type AuthorizationPort,
  type ApprovalPort,
  type EvidencePluginOptions,
} from './plugin.js';
export { loadConfig, type EvidenceConfig } from './config.js';
export { Cmp011Error, mapPgError } from './errors.js';
export { DenyApprovalPort } from './ports/approval.js';
export type { BindingPinPort, EvidencePin } from './ports/binding.js';
export type { UploadedEvidencePort, UploadedEvidence } from './ports/uploads.js';
export type { DocumentClassificationPort } from './ports/ocr.js';
export type { ConsentAccessPort } from './ports/consent.js';
export type { DigiLockerEvidencePort, DigiLockerDocument } from './ports/digilocker.js';
export { SimulatedDigiLockerEvidenceAdapter } from './connectors/digilocker-simulated.js';
export { parsePolicyDefinition } from './domain/policy.js';
export { resolveRequirements } from './domain/resolver.js';
export { TOPIC_DOMAIN, envelopeOf, insertOutbox } from './db/outbox.js';
