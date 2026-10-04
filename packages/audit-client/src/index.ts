export { canonicalJson } from './canonical-json.js';
export { buildAuditEvent, type AuditEventInput, type BuildResult } from './build-event.js';
export { toSubmittedEnvelope, AUDIT_INGEST_TOPIC, AUDIT_EVENT_TYPE } from './envelope.js';
export { toOutboxRow, type OutboxInsertValues } from './outbox-row.js';
export { HttpAuditSink, type AuditAppendResult } from './http-sink.js';
export { requireAudit } from './require-audit.js';
export { assertEventFreeText, assertNoPii } from './pii-guard.js';
export {
  hashEvent,
  hashChainRow,
  sha256,
  toHex,
  GENESIS_HASH_HEX,
  type ChainHashInput,
} from './hash.js';
export { AuditClientError, AuditSinkUnavailableError, PiiRejectedError } from './errors.js';
