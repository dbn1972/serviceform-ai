-- CMP-008 Eligibility / Rules Engine (SF-M04-002). ADR-0006 Option A: sf_cmp008_rw NOLOGIN
-- holds DML; FORCE RLS; PUBLIC revoked; runtime is not table owner (sf_migrator).
-- Rule pack snapshots (pinned published RULES metadata) and evaluation records are append-only.
-- No statutory content is stored here: packs are published metadata resolved through a port.
--
-- Up Migration

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_migrator') THEN
    CREATE ROLE sf_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp008_rw') THEN
    CREATE ROLE sf_cmp008_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp008_rw IS
  'ADR-0006: CMP-008 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_rules AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_rules IS
  'isolation_class=mixed; owner=CMP-008; deterministic rule evaluation records and pinned rule pack snapshots';

REVOKE ALL ON SCHEMA sf_rules FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_rules TO sf_cmp008_rw;
GRANT USAGE ON SCHEMA sf_rules TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_rules REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_rules REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_rules REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_rules.rule_pack_snapshot TENANT_SCOPED owner=CMP-008
CREATE TABLE sf_rules.rule_pack_snapshot (
  snapshot_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  pack_key text NOT NULL CHECK (pack_key ~ '^[a-z][a-z0-9._-]{1,127}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 524288),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, snapshot_id),
  UNIQUE (tenant_id, pack_key, content_hash)
);
ALTER TABLE sf_rules.rule_pack_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_rules.rule_pack_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY rule_pack_snapshot_tenant ON sf_rules.rule_pack_snapshot TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_rules.rule_pack_snapshot OWNER TO sf_migrator;

-- sf:isolation sf_rules.evaluation_record TENANT_SCOPED owner=CMP-008
-- Raw inputs are never stored: input_hash is the canonical SHA-256 of the caller-supplied inputs.
CREATE TABLE sf_rules.evaluation_record (
  evaluation_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  snapshot_id uuid NOT NULL,
  pack_key text NOT NULL CHECK (pack_key ~ '^[a-z][a-z0-9._-]{1,127}$'),
  version_id uuid NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  input_hash text NOT NULL CHECK (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  purpose_code text NOT NULL CHECK (purpose_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  subject_ref text CHECK (subject_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  outcome text CHECK (outcome ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  result_code text NOT NULL CHECK (result_code IN ('RULE_OUTPUT_PRODUCED', 'NO_RULE_OUTPUT')),
  reason_codes jsonb NOT NULL CHECK (jsonb_typeof(reason_codes) = 'array' AND jsonb_array_length(reason_codes) <= 32),
  outputs jsonb NOT NULL CHECK (octet_length(outputs::text) <= 65536),
  matched_rules jsonb NOT NULL CHECK (jsonb_typeof(matched_rules) = 'array'),
  engine_name text NOT NULL CHECK (char_length(engine_name) BETWEEN 1 AND 64),
  engine_version text NOT NULL CHECK (char_length(engine_version) BETWEEN 1 AND 64),
  simulation jsonb,
  requested_by uuid NOT NULL,
  evaluated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, evaluation_id),
  FOREIGN KEY (tenant_id, snapshot_id) REFERENCES sf_rules.rule_pack_snapshot (tenant_id, snapshot_id)
);
CREATE INDEX evaluation_record_pack_idx
  ON sf_rules.evaluation_record (tenant_id, pack_key, evaluated_at DESC);
CREATE INDEX evaluation_record_subject_idx
  ON sf_rules.evaluation_record (tenant_id, subject_ref) WHERE subject_ref IS NOT NULL;
ALTER TABLE sf_rules.evaluation_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_rules.evaluation_record FORCE ROW LEVEL SECURITY;
CREATE POLICY evaluation_record_tenant ON sf_rules.evaluation_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_rules.evaluation_record OWNER TO sf_migrator;

CREATE FUNCTION sf_rules.prevent_record_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'rule pack snapshots and evaluation records are immutable'
    USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
END
$$;
ALTER FUNCTION sf_rules.prevent_record_mutation() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_rules.prevent_record_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_rules.prevent_record_mutation() TO sf_app, sf_cmp008_rw;

CREATE TRIGGER rule_pack_snapshot_immutable
  BEFORE UPDATE OR DELETE ON sf_rules.rule_pack_snapshot
  FOR EACH ROW
  EXECUTE FUNCTION sf_rules.prevent_record_mutation();

CREATE TRIGGER evaluation_record_immutable
  BEFORE UPDATE OR DELETE ON sf_rules.evaluation_record
  FOR EACH ROW
  EXECUTE FUNCTION sf_rules.prevent_record_mutation();

-- sf:isolation sf_rules.idempotency_record TENANT_SCOPED owner=CMP-008
CREATE TABLE sf_rules.idempotency_record (
  tenant_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  endpoint text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
  response_ref text,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, principal_id, endpoint, idempotency_key)
);
ALTER TABLE sf_rules.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_rules.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_tenant ON sf_rules.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_rules.idempotency_record OWNER TO sf_migrator;

GRANT SELECT, INSERT ON sf_rules.rule_pack_snapshot TO sf_cmp008_rw;
GRANT SELECT, INSERT ON sf_rules.evaluation_record TO sf_cmp008_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (
  status, response_ref, response_status, response_body
) ON sf_rules.idempotency_record TO sf_cmp008_rw;

REVOKE ALL ON sf_rules.rule_pack_snapshot FROM PUBLIC;
REVOKE ALL ON sf_rules.evaluation_record FROM PUBLIC;
REVOKE ALL ON sf_rules.idempotency_record FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS evaluation_record_immutable ON sf_rules.evaluation_record;
DROP TRIGGER IF EXISTS rule_pack_snapshot_immutable ON sf_rules.rule_pack_snapshot;
DROP FUNCTION IF EXISTS sf_rules.prevent_record_mutation();
DROP TABLE IF EXISTS sf_rules.idempotency_record;
DROP TABLE IF EXISTS sf_rules.evaluation_record;
DROP TABLE IF EXISTS sf_rules.rule_pack_snapshot;
DROP SCHEMA IF EXISTS sf_rules;
-- Role sf_cmp008_rw retained (may be referenced by runtime logins); never DROP ROLE here.
