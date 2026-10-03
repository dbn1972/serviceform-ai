export const MAX_ENVELOPE_BYTES = 262144;

export const OUTBOX_TABLE = 'outbox_event';
export const OUTBOX_TABLE_PLATFORM = 'outbox_event_platform';
export const INBOX_TABLE = 'inbox_event';
export const INBOX_TABLE_PLATFORM = 'inbox_event_platform';

export const CLAIM_COLUMNS =
  'seq, event_id, topic, partition_key, event_type, schema_version, aggregate_type, aggregate_id, aggregate_version, envelope, status, attempts, next_attempt_at, lease_owner, lease_expires_at, last_error_code, created_at, published_at';
