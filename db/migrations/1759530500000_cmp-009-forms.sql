-- CMP-009 Dynamic Forms Engine (SF-M04-005). ADR-0006 Option A: sf_cmp009_rw NOLOGIN
-- holds DML; FORCE RLS; PUBLIC revoked; runtime is not table owner (sf_migrator).
-- Form definition snapshots (pinned published FORM metadata) and execution records are append-only.
-- Instance field values are never stored: data_hash is the canonical SHA-256 of caller-supplied data.
-- JSON Forms is schema/runtime only; UX4G renderer ids are compatibility metadata, not a second design system.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp009_rw') THEN
    CREATE ROLE sf_cmp009_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp009_rw IS
  'ADR-0006: CMP-009 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_forms AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_forms IS
  'isolation_class=mixed; owner=CMP-009; pinned form snapshots and authoritative validation records';

REVOKE ALL ON SCHEMA sf_forms FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_forms TO sf_cmp009_rw;
GRANT USAGE ON SCHEMA sf_forms TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_forms REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_forms REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_forms REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_forms.form_definition_snapshot TENANT_SCOPED owner=CMP-009
CREATE TABLE sf_forms.form_definition_snapshot (
  snapshot_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  form_key text NOT NULL CHECK (form_key ~ '^[a-z][a-z0-9._-]{1,127}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 524288),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, snapshot_id),
  UNIQUE (tenant_id, form_key, content_hash)
);
ALTER TABLE sf_forms.form_definition_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_forms.form_definition_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY form_definition_snapshot_tenant ON sf_forms.form_definition_snapshot TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_forms.form_definition_snapshot OWNER TO sf_migrator;

-- sf:isolation sf_forms.form_execution_record TENANT_SCOPED owner=CMP-009
CREATE TABLE sf_forms.form_execution_record (
  execution_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  snapshot_id uuid NOT NULL,
  form_key text NOT NULL CHECK (form_key ~ '^[a-z][a-z0-9._-]{1,127}$'),
  version_id uuid NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  data_hash text NOT NULL CHECK (data_hash ~ '^sha256:[0-9a-f]{64}$'),
  purpose_code text NOT NULL CHECK (purpose_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  locale text NOT NULL CHECK (char_length(locale) BETWEEN 2 AND 32),
  result_code text NOT NULL CHECK (result_code IN ('VALID', 'INVALID')),
  visible_fields jsonb NOT NULL CHECK (jsonb_typeof(visible_fields) = 'array'),
  required_fields jsonb NOT NULL CHECK (jsonb_typeof(required_fields) = 'array'),
  errors jsonb NOT NULL CHECK (jsonb_typeof(errors) = 'array' AND octet_length(errors::text) <= 65536),
  renderer_ids jsonb NOT NULL CHECK (jsonb_typeof(renderer_ids) = 'array'),
  requested_by uuid NOT NULL,
  evaluated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, execution_id),
  FOREIGN KEY (tenant_id, snapshot_id) REFERENCES sf_forms.form_definition_snapshot (tenant_id, snapshot_id)
);
CREATE INDEX form_execution_form_idx
  ON sf_forms.form_execution_record (tenant_id, form_key, evaluated_at DESC);
ALTER TABLE sf_forms.form_execution_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_forms.form_execution_record FORCE ROW LEVEL SECURITY;
CREATE POLICY form_execution_record_tenant ON sf_forms.form_execution_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_forms.form_execution_record OWNER TO sf_migrator;

CREATE FUNCTION sf_forms.prevent_record_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'form definition snapshots and execution records are immutable'
    USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
END
$$;
ALTER FUNCTION sf_forms.prevent_record_mutation() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_forms.prevent_record_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_forms.prevent_record_mutation() TO sf_app, sf_cmp009_rw;

CREATE TRIGGER form_definition_snapshot_immutable
  BEFORE UPDATE OR DELETE ON sf_forms.form_definition_snapshot
  FOR EACH ROW
  EXECUTE FUNCTION sf_forms.prevent_record_mutation();

CREATE TRIGGER form_execution_record_immutable
  BEFORE UPDATE OR DELETE ON sf_forms.form_execution_record
  FOR EACH ROW
  EXECUTE FUNCTION sf_forms.prevent_record_mutation();

-- sf:isolation sf_forms.idempotency_record TENANT_SCOPED owner=CMP-009
CREATE TABLE sf_forms.idempotency_record (
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
ALTER TABLE sf_forms.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_forms.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_tenant ON sf_forms.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_forms.idempotency_record OWNER TO sf_migrator;

GRANT SELECT, INSERT ON sf_forms.form_definition_snapshot TO sf_cmp009_rw;
GRANT SELECT, INSERT ON sf_forms.form_execution_record TO sf_cmp009_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (
  status, response_ref, response_status, response_body
) ON sf_forms.idempotency_record TO sf_cmp009_rw;

REVOKE ALL ON sf_forms.form_definition_snapshot FROM PUBLIC;
REVOKE ALL ON sf_forms.form_execution_record FROM PUBLIC;
REVOKE ALL ON sf_forms.idempotency_record FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS form_execution_record_immutable ON sf_forms.form_execution_record;
DROP TRIGGER IF EXISTS form_definition_snapshot_immutable ON sf_forms.form_definition_snapshot;
DROP FUNCTION IF EXISTS sf_forms.prevent_record_mutation();
DROP TABLE IF EXISTS sf_forms.idempotency_record;
DROP TABLE IF EXISTS sf_forms.form_execution_record;
DROP TABLE IF EXISTS sf_forms.form_definition_snapshot;
DROP SCHEMA IF EXISTS sf_forms;
-- Role sf_cmp009_rw retained (may be referenced by runtime logins); never DROP ROLE here.
