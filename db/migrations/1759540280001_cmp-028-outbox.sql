-- CMP-028 outbox/inbox copied from contracts/shared/sql/outbox.template.sql (SF-CON-OUTBOX).
-- Replacements only: {schema}=sf_appeal, {cmp}=CMP-028. Grants unchanged (ADR-0006 condition 9).
--
-- Up Migration

-- SF-CON-OUTBOX v1: normative outbox and inbox layout for every component schema.
-- Copy into the component's own migration, replacing sf_appeal with the component schema and
-- CMP-028 with its CMP id. Do not add columns or change grants without a Contract Change Request.
-- Requires db/migrations/1759490000000_shared-db-contracts.sql (sf_platform.current_tenant_id(),
-- role sf_outbox_publisher).
--
-- Rules (summary; the schema contracts/shared/schemas/outbox-record.schema.json is authoritative
-- for row content):
--  1. Producers INSERT exactly one row per event in the same transaction as the state change,
--     after validating the envelope against SF-CON-EVENT-ENVELOPE. Producers never SELECT,
--     UPDATE or DELETE outbox rows.
--  2. Envelopes with a tenant_id go to outbox_event; envelopes with tenant_id null go to
--     outbox_event_platform.
--  3. The publisher (packages/outbox, CMP-038) runs as a login role that is a member of
--     sf_outbox_publisher only. It claims PENDING rows by setting lease_owner/lease_expires_at
--     in one short transaction, publishes with no transaction open, then sets PUBLISHED (or
--     schedules a retry) in another. An expired lease makes a row claimable again, so delivery
--     is at-least-once.
--  4. For one partition_key, a row is claimable only when no row with a lower seq is PENDING or
--     DEAD_LETTERED. A DEAD_LETTERED row therefore holds its key until an operator replays or
--     discards it through an audited action.
--  5. Consumers record (consumer_group, event_id) in inbox_event or inbox_event_platform in the
--     same transaction as their own state change; a conflict means the event was already applied.
--  6. The publisher deletes PUBLISHED rows only after the topic's retention window in the CMP-038
--     topic registry.

-- sf:isolation sf_appeal.outbox_event TENANT_SCOPED owner=CMP-028
CREATE TABLE sf_appeal.outbox_event (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  tenant_id uuid NOT NULL,
  topic text NOT NULL CHECK (topic ~ '^[a-zA-Z0-9._-]{3,249}$'),
  partition_key text NOT NULL CHECK (length(partition_key) BETWEEN 1 AND 200),
  event_type text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version >= 1),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 0),
  envelope jsonb NOT NULL CHECK (octet_length(envelope::text) <= 262144),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'DEAD_LETTERED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text CHECK (last_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CHECK (envelope ->> 'event_id' = event_id::text),
  CHECK (envelope ->> 'tenant_id' = tenant_id::text),
  CHECK (envelope ->> 'aggregate_id' = aggregate_id::text),
  CHECK (envelope ->> 'event_type' = event_type)
);
CREATE INDEX outbox_event_claim_idx ON sf_appeal.outbox_event (partition_key, seq) WHERE status <> 'PUBLISHED';
CREATE INDEX outbox_event_due_idx ON sf_appeal.outbox_event (next_attempt_at) WHERE status = 'PENDING';
ALTER TABLE sf_appeal.outbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_appeal.outbox_event FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_event_tenant_insert ON sf_appeal.outbox_event FOR INSERT TO sf_app
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
CREATE POLICY outbox_event_publisher ON sf_appeal.outbox_event TO sf_outbox_publisher
  USING (true) WITH CHECK (true);
GRANT INSERT ON sf_appeal.outbox_event TO sf_app;

-- sf:isolation sf_appeal.outbox_event_platform PLATFORM_OPERATIONAL owner=CMP-028
CREATE TABLE sf_appeal.outbox_event_platform (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  topic text NOT NULL CHECK (topic ~ '^[a-zA-Z0-9._-]{3,249}$'),
  partition_key text NOT NULL CHECK (length(partition_key) BETWEEN 1 AND 200),
  event_type text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version >= 1),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 0),
  envelope jsonb NOT NULL CHECK (octet_length(envelope::text) <= 262144),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'DEAD_LETTERED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text CHECK (last_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CHECK (envelope ->> 'event_id' = event_id::text),
  CHECK (jsonb_typeof(envelope -> 'tenant_id') = 'null'),
  CHECK (envelope ->> 'aggregate_id' = aggregate_id::text),
  CHECK (envelope ->> 'event_type' = event_type)
);
CREATE INDEX outbox_event_platform_claim_idx ON sf_appeal.outbox_event_platform (partition_key, seq) WHERE status <> 'PUBLISHED';
CREATE INDEX outbox_event_platform_due_idx ON sf_appeal.outbox_event_platform (next_attempt_at) WHERE status = 'PENDING';
GRANT INSERT ON sf_appeal.outbox_event_platform TO sf_app;

GRANT USAGE ON SCHEMA sf_appeal TO sf_outbox_publisher;
GRANT SELECT, DELETE ON sf_appeal.outbox_event, sf_appeal.outbox_event_platform TO sf_outbox_publisher;
GRANT UPDATE (status, attempts, next_attempt_at, lease_owner, lease_expires_at, last_error_code, published_at)
  ON sf_appeal.outbox_event, sf_appeal.outbox_event_platform TO sf_outbox_publisher;

-- sf:isolation sf_appeal.inbox_event TENANT_SCOPED owner=CMP-028
CREATE TABLE sf_appeal.inbox_event (
  consumer_group text NOT NULL CHECK (consumer_group ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  event_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_group, event_id)
);
ALTER TABLE sf_appeal.inbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_appeal.inbox_event FORCE ROW LEVEL SECURITY;
CREATE POLICY inbox_event_tenant ON sf_appeal.inbox_event TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
GRANT SELECT, INSERT ON sf_appeal.inbox_event TO sf_app;

-- sf:isolation sf_appeal.inbox_event_platform PLATFORM_OPERATIONAL owner=CMP-028
CREATE TABLE sf_appeal.inbox_event_platform (
  consumer_group text NOT NULL CHECK (consumer_group ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  event_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_group, event_id)
);
GRANT SELECT, INSERT ON sf_appeal.inbox_event_platform TO sf_app;

-- Identity sequences are required for the frozen template GRANT INSERT … TO sf_app.
-- Table grants in the template body above are unchanged (ADR-0006 condition 9).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA sf_appeal TO sf_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_appeal FROM PUBLIC;
ALTER TABLE sf_appeal.outbox_event OWNER TO sf_migrator;
ALTER TABLE sf_appeal.outbox_event_platform OWNER TO sf_migrator;
ALTER TABLE sf_appeal.inbox_event OWNER TO sf_migrator;
ALTER TABLE sf_appeal.inbox_event_platform OWNER TO sf_migrator;

-- Down Migration
DROP TABLE IF EXISTS sf_appeal.inbox_event_platform;
DROP TABLE IF EXISTS sf_appeal.inbox_event;
DROP TABLE IF EXISTS sf_appeal.outbox_event_platform;
DROP TABLE IF EXISTS sf_appeal.outbox_event;
