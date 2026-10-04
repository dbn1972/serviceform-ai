-- CMP-033 Metadata / Configuration Service (SF-M03-002). ADR-0006 Option A: sf_cmp033_rw NOLOGIN
-- holds DML; FORCE RLS; PUBLIC revoked; runtime is not table owner (sf_migrator).
-- Draft metadata, structural schema validation, config composition. Published rows are immutable.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp033_rw') THEN
    CREATE ROLE sf_cmp033_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp033_rw IS
  'ADR-0006: CMP-033 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_metadata AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_metadata IS
  'isolation_class=mixed; owner=CMP-033; draft metadata, validation, composition';

REVOKE ALL ON SCHEMA sf_metadata FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_metadata TO sf_cmp033_rw;
GRANT USAGE ON SCHEMA sf_metadata TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_metadata REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_metadata REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_metadata REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_metadata.metadata_document TENANT_SCOPED owner=CMP-033
CREATE TABLE sf_metadata.metadata_document (
  document_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  document_key text NOT NULL CHECK (document_key ~ '^[a-z][a-z0-9._-]{1,127}$'),
  kind text NOT NULL CHECK (kind IN (
    'SERVICE', 'OFFERING', 'FORM', 'RULES', 'EVIDENCE', 'FEE',
    'WORKFLOW', 'SLA', 'ACCESS', 'CREDENTIAL', 'NOTIFICATION'
  )),
  schema_id text NOT NULL CHECK (schema_id ~ '^sf\.metadata\.kind\.[a-z]+\.v[0-9]+$'),
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 262144),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('DRAFT', 'VALIDATED', 'COMPOSED', 'PUBLISHED')),
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  published_at timestamptz,
  UNIQUE (tenant_id, document_id),
  UNIQUE (tenant_id, kind, document_key),
  CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL)
);
CREATE INDEX metadata_document_tenant_kind_idx
  ON sf_metadata.metadata_document (tenant_id, kind, status);
ALTER TABLE sf_metadata.metadata_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_metadata.metadata_document FORCE ROW LEVEL SECURITY;
CREATE POLICY metadata_document_tenant ON sf_metadata.metadata_document TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_metadata.metadata_document OWNER TO sf_migrator;

CREATE FUNCTION sf_metadata.prevent_published_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'published metadata is immutable'
      USING ERRCODE = 'P0001', HINT = 'SF_PUBLISHED_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_metadata.prevent_published_mutation() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_metadata.prevent_published_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_metadata.prevent_published_mutation() TO sf_app, sf_cmp033_rw;

CREATE TRIGGER metadata_document_published_immutable
  BEFORE UPDATE ON sf_metadata.metadata_document
  FOR EACH ROW
  EXECUTE FUNCTION sf_metadata.prevent_published_mutation();

-- sf:isolation sf_metadata.metadata_bundle TENANT_SCOPED owner=CMP-033
CREATE TABLE sf_metadata.metadata_bundle (
  bundle_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  bundle_key text NOT NULL CHECK (bundle_key ~ '^[a-z][a-z0-9._-]{1,127}$'),
  composition_hash text NOT NULL CHECK (composition_hash ~ '^sha256:[0-9a-f]{64}$'),
  document_ids uuid[] NOT NULL CHECK (cardinality(document_ids) >= 1),
  missing_kinds text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL CHECK (status IN ('COMPOSED', 'PUBLISHED')),
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (tenant_id, bundle_id),
  UNIQUE (tenant_id, bundle_key, composition_hash),
  CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL)
);
ALTER TABLE sf_metadata.metadata_bundle ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_metadata.metadata_bundle FORCE ROW LEVEL SECURITY;
CREATE POLICY metadata_bundle_tenant ON sf_metadata.metadata_bundle TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_metadata.metadata_bundle OWNER TO sf_migrator;

CREATE FUNCTION sf_metadata.prevent_published_bundle_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'published metadata is immutable'
      USING ERRCODE = 'P0001', HINT = 'SF_PUBLISHED_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_metadata.prevent_published_bundle_mutation() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_metadata.prevent_published_bundle_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_metadata.prevent_published_bundle_mutation() TO sf_app, sf_cmp033_rw;

CREATE TRIGGER metadata_bundle_published_immutable
  BEFORE UPDATE ON sf_metadata.metadata_bundle
  FOR EACH ROW
  EXECUTE FUNCTION sf_metadata.prevent_published_bundle_mutation();

-- sf:isolation sf_metadata.idempotency_record TENANT_SCOPED owner=CMP-033
CREATE TABLE sf_metadata.idempotency_record (
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
ALTER TABLE sf_metadata.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_metadata.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_tenant ON sf_metadata.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_metadata.idempotency_record OWNER TO sf_migrator;

GRANT SELECT, INSERT, UPDATE (
  payload, schema_id, payload_hash, status, aggregate_version,
  updated_at, validated_at, published_at
) ON sf_metadata.metadata_document TO sf_cmp033_rw;
GRANT SELECT, INSERT, UPDATE (
  status, aggregate_version, published_at
) ON sf_metadata.metadata_bundle TO sf_cmp033_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (
  status, response_ref, response_status, response_body
) ON sf_metadata.idempotency_record TO sf_cmp033_rw;

REVOKE ALL ON sf_metadata.metadata_document FROM PUBLIC;
REVOKE ALL ON sf_metadata.metadata_bundle FROM PUBLIC;
REVOKE ALL ON sf_metadata.idempotency_record FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS metadata_bundle_published_immutable ON sf_metadata.metadata_bundle;
DROP TRIGGER IF EXISTS metadata_document_published_immutable ON sf_metadata.metadata_document;
DROP FUNCTION IF EXISTS sf_metadata.prevent_published_bundle_mutation();
DROP FUNCTION IF EXISTS sf_metadata.prevent_published_mutation();
DROP TABLE IF EXISTS sf_metadata.idempotency_record;
DROP TABLE IF EXISTS sf_metadata.metadata_bundle;
DROP TABLE IF EXISTS sf_metadata.metadata_document;
DROP SCHEMA IF EXISTS sf_metadata;
-- Role sf_cmp033_rw retained (may be referenced by runtime logins); never DROP ROLE here.
