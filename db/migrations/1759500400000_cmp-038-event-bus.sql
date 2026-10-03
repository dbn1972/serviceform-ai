-- CMP-038 Event Bus: topic registry, schema metadata, consumer checkpoints, and
-- this component's outbox/inbox copied from SF-CON-OUTBOX.
-- sf:schema sf_event_bus PLATFORM_OPERATIONAL owner=CMP-038
--
-- Registry tables are GRANT-only (no ENABLE RLS). FORCE RLS applies only to the
-- TENANT_SCOPED outbox_event and inbox_event tables from the frozen template.
-- Role creation: DO $$ IF NOT EXISTS (pg_roles) CREATE ROLE … (PostgreSQL has no
-- CREATE ROLE IF NOT EXISTS). Shared sf_migrator is created here if missing; this
-- migration does not become a competing writer of a platform baseline role.

-- Up Migration

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_migrator') THEN
    CREATE ROLE sf_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_migrator IS
  'ADR-0006: deployment/migration role. Owns component schemas/tables. Never used as an application runtime identity.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp038_rw') THEN
    CREATE ROLE sf_cmp038_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp038_rw IS
  'ADR-0006: CMP-038 NOLOGIN privilege role. Holds DML on sf_event_bus registry tables only.';

CREATE SCHEMA sf_event_bus;
COMMENT ON SCHEMA sf_event_bus IS
  'isolation_class=PLATFORM_OPERATIONAL; owner=CMP-038; topic registry, checkpoints, component outbox';

REVOKE ALL ON SCHEMA sf_event_bus FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_event_bus TO sf_app;
GRANT USAGE ON SCHEMA sf_event_bus TO sf_cmp038_rw;

ALTER DEFAULT PRIVILEGES IN SCHEMA sf_event_bus REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA sf_event_bus REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA sf_event_bus REVOKE ALL ON TABLES FROM sf_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA sf_event_bus REVOKE ALL ON SEQUENCES FROM sf_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_event_bus REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_event_bus REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_event_bus REVOKE ALL ON TABLES FROM sf_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_event_bus REVOKE ALL ON SEQUENCES FROM sf_app;

-- sf:isolation sf_event_bus.topic PLATFORM_OPERATIONAL owner=CMP-038
CREATE TABLE sf_event_bus.topic (
  topic_name text PRIMARY KEY CHECK (topic_name ~ '^[a-zA-Z0-9._-]{3,249}$'),
  owner_component text NOT NULL CHECK (owner_component ~ '^CMP-0[0-9]{2}$'),
  tenancy text NOT NULL CHECK (tenancy IN ('TENANT_SCOPED', 'PLATFORM_OPERATIONAL')),
  partition_key_strategy text NOT NULL CHECK (partition_key_strategy IN ('AGGREGATE_ID', 'DECLARED')),
  partitions integer NOT NULL CHECK (partitions >= 1 AND partitions <= 1000),
  replication_factor integer NOT NULL CHECK (replication_factor >= 1 AND replication_factor <= 12),
  broker_retention interval NOT NULL,
  outbox_retention interval NOT NULL,
  replay_class text NOT NULL CHECK (replay_class ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  compatibility text NOT NULL CHECK (compatibility IN ('BACKWARD', 'FORWARD', 'FULL')),
  dlq_topic text NOT NULL CHECK (dlq_topic ~ '^[a-zA-Z0-9._-]{3,249}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DEPRECATED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- sf:isolation sf_event_bus.event_schema PLATFORM_OPERATIONAL owner=CMP-038
CREATE TABLE sf_event_bus.event_schema (
  topic_name text NOT NULL REFERENCES sf_event_bus.topic (topic_name),
  event_type text NOT NULL CHECK (event_type ~ '^[A-Z][A-Za-z0-9]{2,79}$'),
  schema_version integer NOT NULL CHECK (schema_version >= 1),
  data_schema jsonb NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (topic_name, event_type, schema_version)
);

-- sf:isolation sf_event_bus.consumer_checkpoint PLATFORM_OPERATIONAL owner=CMP-038
CREATE TABLE sf_event_bus.consumer_checkpoint (
  consumer_group text NOT NULL CHECK (consumer_group ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  topic_name text NOT NULL,
  partition integer NOT NULL CHECK (partition >= 0),
  committed_offset bigint NOT NULL,
  log_end_offset bigint NOT NULL,
  lag bigint NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_group, topic_name, partition)
);

CREATE FUNCTION sf_event_bus.refuse_event_schema_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'event_schema is insert-only'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER event_schema_immutable
  BEFORE UPDATE OR DELETE ON sf_event_bus.event_schema
  FOR EACH ROW EXECUTE FUNCTION sf_event_bus.refuse_event_schema_mutation();

GRANT SELECT, INSERT ON sf_event_bus.topic TO sf_cmp038_rw;
GRANT UPDATE (partitions, replication_factor, broker_retention, outbox_retention, replay_class, status)
  ON sf_event_bus.topic TO sf_cmp038_rw;
GRANT SELECT, INSERT ON sf_event_bus.event_schema TO sf_cmp038_rw;
GRANT SELECT, INSERT, UPDATE ON sf_event_bus.consumer_checkpoint TO sf_cmp038_rw;

REVOKE ALL ON TABLE sf_event_bus.topic, sf_event_bus.event_schema, sf_event_bus.consumer_checkpoint FROM PUBLIC;
REVOKE ALL ON TABLE sf_event_bus.topic, sf_event_bus.event_schema, sf_event_bus.consumer_checkpoint FROM sf_app;

-- BEGIN SF-CON-OUTBOX (copied unchanged from contracts/shared/sql/outbox.template.sql)
-- SF-CON-OUTBOX v1: normative outbox and inbox layout for every component schema.
-- Copy into the component's own migration, replacing {schema} with the component schema and
-- {cmp} with its CMP id. Do not add columns or change grants without a Contract Change Request.
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

-- sf:isolation sf_event_bus.outbox_event TENANT_SCOPED owner=CMP-038
CREATE TABLE sf_event_bus.outbox_event (
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
CREATE INDEX outbox_event_claim_idx ON sf_event_bus.outbox_event (partition_key, seq) WHERE status <> 'PUBLISHED';
CREATE INDEX outbox_event_due_idx ON sf_event_bus.outbox_event (next_attempt_at) WHERE status = 'PENDING';
ALTER TABLE sf_event_bus.outbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_event_bus.outbox_event FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_event_tenant_insert ON sf_event_bus.outbox_event FOR INSERT TO sf_app
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
CREATE POLICY outbox_event_publisher ON sf_event_bus.outbox_event TO sf_outbox_publisher
  USING (true) WITH CHECK (true);
GRANT INSERT ON sf_event_bus.outbox_event TO sf_app;

-- sf:isolation sf_event_bus.outbox_event_platform PLATFORM_OPERATIONAL owner=CMP-038
CREATE TABLE sf_event_bus.outbox_event_platform (
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
CREATE INDEX outbox_event_platform_claim_idx ON sf_event_bus.outbox_event_platform (partition_key, seq) WHERE status <> 'PUBLISHED';
CREATE INDEX outbox_event_platform_due_idx ON sf_event_bus.outbox_event_platform (next_attempt_at) WHERE status = 'PENDING';
GRANT INSERT ON sf_event_bus.outbox_event_platform TO sf_app;

GRANT USAGE ON SCHEMA sf_event_bus TO sf_outbox_publisher;
GRANT SELECT, DELETE ON sf_event_bus.outbox_event, sf_event_bus.outbox_event_platform TO sf_outbox_publisher;
GRANT UPDATE (status, attempts, next_attempt_at, lease_owner, lease_expires_at, last_error_code, published_at)
  ON sf_event_bus.outbox_event, sf_event_bus.outbox_event_platform TO sf_outbox_publisher;

-- sf:isolation sf_event_bus.inbox_event TENANT_SCOPED owner=CMP-038
CREATE TABLE sf_event_bus.inbox_event (
  consumer_group text NOT NULL CHECK (consumer_group ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  event_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_group, event_id)
);
ALTER TABLE sf_event_bus.inbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_event_bus.inbox_event FORCE ROW LEVEL SECURITY;
CREATE POLICY inbox_event_tenant ON sf_event_bus.inbox_event TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
GRANT SELECT, INSERT ON sf_event_bus.inbox_event TO sf_app;

-- sf:isolation sf_event_bus.inbox_event_platform PLATFORM_OPERATIONAL owner=CMP-038
CREATE TABLE sf_event_bus.inbox_event_platform (
  consumer_group text NOT NULL CHECK (consumer_group ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  event_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_group, event_id)
);
GRANT SELECT, INSERT ON sf_event_bus.inbox_event_platform TO sf_app;
-- END SF-CON-OUTBOX

-- Sequence USAGE is required for IDENTITY nextval() on INSERT. This is not a
-- table-grant change to the frozen template (ADR-0006 #9).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA sf_event_bus TO sf_app;

DO $$
DECLARE
  obj record;
BEGIN
  FOR obj IN
    SELECT c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'sf_event_bus' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE sf_event_bus.%I OWNER TO sf_migrator', obj.relname);
  END LOOP;
  ALTER FUNCTION sf_event_bus.refuse_event_schema_mutation() OWNER TO sf_migrator;
  ALTER SCHEMA sf_event_bus OWNER TO sf_migrator;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA sf_event_bus FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_event_bus FROM PUBLIC;

-- Down Migration

DROP SCHEMA IF EXISTS sf_event_bus CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp038_rw')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_auth_members m
       JOIN pg_roles r ON r.oid = m.roleid
       WHERE r.rolname = 'sf_cmp038_rw'
     )
  THEN
    DROP ROLE sf_cmp038_rw;
  END IF;
END
$$;
