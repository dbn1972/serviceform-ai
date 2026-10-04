-- CMP-052 Versioning & Configuration Registry (SF-M03-004). ADR-0006 Option A: sf_cmp052_rw NOLOGIN
-- holds DML; FORCE RLS; PUBLIC revoked; runtime is not table owner (sf_migrator).
-- Published artifacts and TenantServiceBinding pins are immutable. Applications pin published versions.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp052_rw') THEN
    CREATE ROLE sf_cmp052_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp052_rw IS
  'ADR-0006: CMP-052 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_versioning AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_versioning IS
  'isolation_class=mixed; owner=CMP-052; version registry and TenantServiceBinding pins';

REVOKE ALL ON SCHEMA sf_versioning FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_versioning TO sf_cmp052_rw;
GRANT USAGE ON SCHEMA sf_versioning TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_versioning REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_versioning REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_versioning REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_versioning.tenant_service_binding TENANT_SCOPED owner=CMP-052
CREATE TABLE sf_versioning.tenant_service_binding (
  binding_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  binding_key text NOT NULL CHECK (binding_key ~ '^[a-z][a-z0-9._-]{1,127}$'),
  offering_ref text NOT NULL CHECK (char_length(offering_ref) BETWEEN 1 AND 200),
  metadata_bundle_ref text NOT NULL CHECK (char_length(metadata_bundle_ref) BETWEEN 1 AND 200),
  pins jsonb NOT NULL CHECK (octet_length(pins::text) <= 65536),
  dependency_graph jsonb NOT NULL CHECK (octet_length(dependency_graph::text) <= 65536),
  artifact_hash text NOT NULL CHECK (artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
  published_version_id uuid,
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (tenant_id, binding_id),
  UNIQUE (tenant_id, binding_key, artifact_hash),
  CHECK (status <> 'PUBLISHED' OR (published_at IS NOT NULL AND published_version_id IS NOT NULL))
);
CREATE INDEX tenant_service_binding_key_idx
  ON sf_versioning.tenant_service_binding (tenant_id, binding_key, status);
ALTER TABLE sf_versioning.tenant_service_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_versioning.tenant_service_binding FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_service_binding_tenant ON sf_versioning.tenant_service_binding TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_versioning.tenant_service_binding OWNER TO sf_migrator;

CREATE FUNCTION sf_versioning.prevent_published_binding_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'PUBLISHED' THEN
      RAISE EXCEPTION 'published TenantServiceBinding is immutable'
        USING ERRCODE = 'P0001', HINT = 'SF_PUBLISHED_IMMUTABLE';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'published TenantServiceBinding is immutable'
      USING ERRCODE = 'P0001', HINT = 'SF_PUBLISHED_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_versioning.prevent_published_binding_mutation() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_versioning.prevent_published_binding_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_versioning.prevent_published_binding_mutation() TO sf_app, sf_cmp052_rw;

CREATE TRIGGER tenant_service_binding_published_immutable
  BEFORE UPDATE OR DELETE ON sf_versioning.tenant_service_binding
  FOR EACH ROW
  EXECUTE FUNCTION sf_versioning.prevent_published_binding_mutation();

-- sf:isolation sf_versioning.artifact_version TENANT_SCOPED owner=CMP-052
CREATE TABLE sf_versioning.artifact_version (
  version_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  artifact_kind text NOT NULL CHECK (artifact_kind IN ('TENANT_SERVICE_BINDING')),
  artifact_key text NOT NULL CHECK (artifact_key ~ '^[a-z][a-z0-9._-]{1,127}$'),
  version_no bigint NOT NULL CHECK (version_no >= 1),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  dependency_graph jsonb NOT NULL CHECK (octet_length(dependency_graph::text) <= 65536),
  source_binding_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('PUBLISHED')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz NOT NULL,
  UNIQUE (tenant_id, version_id),
  UNIQUE (tenant_id, artifact_kind, artifact_key, version_no),
  UNIQUE (tenant_id, artifact_kind, artifact_key, content_hash)
);
CREATE INDEX artifact_version_lookup_idx
  ON sf_versioning.artifact_version (tenant_id, artifact_kind, artifact_key, version_no DESC);
ALTER TABLE sf_versioning.artifact_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_versioning.artifact_version FORCE ROW LEVEL SECURITY;
CREATE POLICY artifact_version_tenant ON sf_versioning.artifact_version TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_versioning.artifact_version OWNER TO sf_migrator;

CREATE FUNCTION sf_versioning.prevent_published_artifact_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'published artifact version is immutable'
    USING ERRCODE = 'P0001', HINT = 'SF_PUBLISHED_IMMUTABLE';
END
$$;
ALTER FUNCTION sf_versioning.prevent_published_artifact_mutation() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_versioning.prevent_published_artifact_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_versioning.prevent_published_artifact_mutation() TO sf_app, sf_cmp052_rw;

CREATE TRIGGER artifact_version_published_immutable
  BEFORE UPDATE OR DELETE ON sf_versioning.artifact_version
  FOR EACH ROW
  EXECUTE FUNCTION sf_versioning.prevent_published_artifact_mutation();

-- sf:isolation sf_versioning.idempotency_record TENANT_SCOPED owner=CMP-052
CREATE TABLE sf_versioning.idempotency_record (
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
ALTER TABLE sf_versioning.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_versioning.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_tenant ON sf_versioning.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_versioning.idempotency_record OWNER TO sf_migrator;

GRANT SELECT, INSERT, UPDATE (
  offering_ref, metadata_bundle_ref, pins, dependency_graph, artifact_hash,
  status, published_version_id, aggregate_version, updated_at, published_at
) ON sf_versioning.tenant_service_binding TO sf_cmp052_rw;
GRANT SELECT, INSERT ON sf_versioning.artifact_version TO sf_cmp052_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (
  status, response_ref, response_status, response_body
) ON sf_versioning.idempotency_record TO sf_cmp052_rw;

REVOKE ALL ON sf_versioning.tenant_service_binding FROM PUBLIC;
REVOKE ALL ON sf_versioning.artifact_version FROM PUBLIC;
REVOKE ALL ON sf_versioning.idempotency_record FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS artifact_version_published_immutable ON sf_versioning.artifact_version;
DROP TRIGGER IF EXISTS tenant_service_binding_published_immutable ON sf_versioning.tenant_service_binding;
DROP FUNCTION IF EXISTS sf_versioning.prevent_published_artifact_mutation();
DROP FUNCTION IF EXISTS sf_versioning.prevent_published_binding_mutation();
DROP TABLE IF EXISTS sf_versioning.idempotency_record;
DROP TABLE IF EXISTS sf_versioning.artifact_version;
DROP TABLE IF EXISTS sf_versioning.tenant_service_binding;
DROP SCHEMA IF EXISTS sf_versioning;
-- Role sf_cmp052_rw retained (may be referenced by runtime logins); never DROP ROLE here.
