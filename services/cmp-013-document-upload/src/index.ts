export {
  buildUploadService,
  documentUploadPlugin,
  registerDocumentUpload,
  type DocumentUploadPluginOptions,
} from './plugin.js';
export type { AuthorizationPort } from './authz.js';
export { Cmp013Error } from './errors.js';
export type {
  DocumentStoragePort,
  DownloadAccess,
  ObjectInspection,
  UploadTarget,
} from './ports/storage-port.js';
export type { MalwareScanPort, ScanOutcome } from './ports/scan-port.js';
export { SimulatedDocumentStorage } from './adapters/simulated-storage.js';
export {
  SimulatedMalwareScanner,
  SIMULATED_MALWARE_SIGNATURE,
} from './adapters/simulated-scanner.js';
export { PgUploadRepository } from './repo/pg.js';
export type { UploadRepository, UploadTx } from './repo/types.js';
export {
  SCAN_CONSUMER_GROUP,
  UploadService,
  documentView,
  type DocumentView,
  type ScanResult,
} from './service/upload-service.js';
export { TOPIC_DOMAIN, TOPIC_AUDIT, DOMAIN_EVENT_TYPES } from './outbox.js';
export { isUsableAsEvidence, canTransition } from './domain/states.js';
export { isSafeObjectKey, isKeyOwnedByTenant, documentObjectKey } from './domain/object-key.js';
export { SNIFFABLE_CONTENT_TYPES, sniffContentType } from './domain/content-type.js';
export { assertSimulationPolicy } from './domain/simulation.js';
