-- CMP-011 Evidence & Document Requirement Engine (SF-M04-003). ADR-0006 Option A: sf_cmp011_rw NOLOGIN
-- holds DML; FORCE RLS; PUBLIC revoked; runtime is not table owner (sf_migrator).
-- Evidence policies are versioned metadata. A published policy version is immutable; applications pin
-- (version_ref, content_hash) through TenantServiceBinding (CMP-052). Resolution outcomes are append-only.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp011_rw') THEN
    CREATE ROLE sf_cmp011_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp011_rw IS
  'ADR-0006: CMP-011 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_evidence AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_evidence IS
  'isolation_class=tenant_scoped; owner=CMP-011; evidence policy versions and requirement resolution outcomes';

REVOKE ALL ON SCHEMA sf_evidence FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_evidence TO sf_cmp011_rw;
GRANT USAGE ON SCHEMA sf_evidence TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_evidence REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_evidence REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_evidence REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_evidence.evidence_policy TENANT_SCOPED owner=CMP-011
CREATE TABLE sf_evidence.evidence_policy (
  policy_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  policy_key text NOT NULL CHECK (policy_key ~ '^[a-z][a-z0-9._-]{1,127}$'),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED')),
  version_no bigint CHECK (version_no >= 1),
  version_ref text CHECK (char_length(version_ref) BETWEEN 3 AND 200),
  definition jsonb NOT NULL CHECK (octet_length(definition::text) <= 262144),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (tenant_id, policy_id),
  CHECK (
    status <> 'PUBLISHED'
    OR (version_no IS NOT NULL AND version_ref IS NOT NULL AND published_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX evidence_policy_version_uq
  ON sf_evidence.evidence_policy (tenant_id, policy_key, version_no) WHERE status = 'PUBLISHED';
CREATE UNIQUE INDEX evidence_policy_version_ref_uq
  ON sf_evidence.evidence_policy (tenant_id, version_ref) WHERE status = 'PUBLISHED';
CREATE INDEX evidence_policy_key_idx
  ON sf_evidence.evidence_policy (tenant_id, policy_key, status);
ALTER TABLE sf_evidence.evidence_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_evidence.evidence_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_policy_tenant ON sf_evidence.evidence_policy TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_evidence.evidence_policy OWNER TO sf_migrator;

CREATE FUNCTION sf_evidence.prevent_published_policy_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'PUBLISHED' THEN
      RAISE EXCEPTION 'published evidence policy version is immutable'
        USING ERRCODE = 'P0001', HINT = 'SF_PUBLISHED_IMMUTABLE';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'published evidence policy version is immutable'
      USING ERRCODE = 'P0001', HINT = 'SF_PUBLISHED_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_evidence.prevent_published_policy_mutation() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_evidence.prevent_published_policy_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_evidence.prevent_published_policy_mutation() TO sf_app, sf_cmp011_rw;

CREATE TRIGGER evidence_policy_published_immutable
  BEFORE UPDATE OR DELETE ON sf_evidence.evidence_policy
  FOR EACH ROW
  EXECUTE FUNCTION sf_evidence.prevent_published_policy_mutation();

-- sf:isolation sf_evidence.evidence_resolution TENANT_SCOPED owner=CMP-011
CREATE TABLE sf_evidence.evidence_resolution (
  resolution_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  binding_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  version_ref text NOT NULL CHECK (char_length(version_ref) BETWEEN 3 AND 200),
  policy_content_hash text NOT NULL CHECK (policy_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  application_ref text CHECK (application_ref IS NULL OR char_length(application_ref) BETWEEN 1 AND 200),
  input_hash text NOT NULL CHECK (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  decision_hash text NOT NULL CHECK (decision_hash ~ '^sha256:[0-9a-f]{64}$'),
  checklist jsonb NOT NULL CHECK (octet_length(checklist::text) <= 262144),
  decision_trace jsonb NOT NULL CHECK (octet_length(decision_trace::text) <= 262144),
  simulated boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, resolution_id),
  FOREIGN KEY (tenant_id, policy_id) REFERENCES sf_evidence.evidence_policy (tenant_id, policy_id)
);
CREATE INDEX evidence_resolution_binding_idx
  ON sf_evidence.evidence_resolution (tenant_id, binding_id, created_at DESC);
ALTER TABLE sf_evidence.evidence_resolution ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_evidence.evidence_resolution FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_resolution_tenant ON sf_evidence.evidence_resolution TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_evidence.evidence_resolution OWNER TO sf_migrator;

CREATE FUNCTION sf_evidence.prevent_resolution_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'evidence resolution outcome is append-only'
    USING ERRCODE = 'P0001', HINT = 'SF_PUBLISHED_IMMUTABLE';
END
$$;
ALTER FUNCTION sf_evidence.prevent_resolution_mutation() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_evidence.prevent_resolution_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_evidence.prevent_resolution_mutation() TO sf_app, sf_cmp011_rw;

CREATE TRIGGER evidence_resolution_append_only
  BEFORE UPDATE OR DELETE ON sf_evidence.evidence_resolution
  FOR EACH ROW
  EXECUTE FUNCTION sf_evidence.prevent_resolution_mutation();

-- sf:isolation sf_evidence.idempotency_record TENANT_SCOPED owner=CMP-011
CREATE TABLE sf_evidence.idempotency_record (
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
ALTER TABLE sf_evidence.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_evidence.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_tenant ON sf_evidence.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_evidence.idempotency_record OWNER TO sf_migrator;

GRANT SELECT, INSERT, UPDATE (definition, content_hash, status, version_no, version_ref, aggregate_version, updated_at, published_at)
  ON sf_evidence.evidence_policy TO sf_cmp011_rw;
GRANT SELECT, INSERT ON sf_evidence.evidence_resolution TO sf_cmp011_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (
  status, response_ref, response_status, response_body
) ON sf_evidence.idempotency_record TO sf_cmp011_rw;

REVOKE ALL ON sf_evidence.evidence_policy FROM PUBLIC;
REVOKE ALL ON sf_evidence.evidence_resolution FROM PUBLIC;
REVOKE ALL ON sf_evidence.idempotency_record FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS evidence_resolution_append_only ON sf_evidence.evidence_resolution;
DROP TRIGGER IF EXISTS evidence_policy_published_immutable ON sf_evidence.evidence_policy;
DROP FUNCTION IF EXISTS sf_evidence.prevent_resolution_mutation();
DROP FUNCTION IF EXISTS sf_evidence.prevent_published_policy_mutation();
DROP TABLE IF EXISTS sf_evidence.idempotency_record;
DROP TABLE IF EXISTS sf_evidence.evidence_resolution;
DROP TABLE IF EXISTS sf_evidence.evidence_policy;
DROP SCHEMA IF EXISTS sf_evidence;
-- Role sf_cmp011_rw retained (may be referenced by runtime logins); never DROP ROLE here.
