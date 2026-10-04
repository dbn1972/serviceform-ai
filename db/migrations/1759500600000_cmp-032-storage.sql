-- CMP-032 Storage Service (SF-M01-W2-003). ADR-0006 Option A: sf_cmp032_rw NOLOGIN
-- holds DML; FORCE RLS; PUBLIC revoked; runtime is not table owner (sf_migrator).
-- SIMULATED/local object bytes live outside durable pod FS; metadata is authoritative here.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp032_rw') THEN
    CREATE ROLE sf_cmp032_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp032_rw IS
  'ADR-0006: CMP-032 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_storage AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_storage IS
  'isolation_class=mixed; owner=CMP-032; object metadata and storage policy';

REVOKE ALL ON SCHEMA sf_storage FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_storage TO sf_cmp032_rw;
GRANT USAGE ON SCHEMA sf_storage TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_storage REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_storage REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_storage REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_storage.storage_policy TENANT_SCOPED owner=CMP-032
CREATE TABLE sf_storage.storage_policy (
  policy_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  encryption_algorithm text NOT NULL CHECK (encryption_algorithm IN ('AES_256_GCM')),
  kms_key_ref text NOT NULL CHECK (char_length(kms_key_ref) BETWEEN 1 AND 256),
  max_object_bytes bigint NOT NULL CHECK (max_object_bytes > 0 AND max_object_bytes <= 104857600),
  allowed_content_types text[] NOT NULL CHECK (cardinality(allowed_content_types) >= 1),
  retention_class text NOT NULL CHECK (retention_class ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, policy_id)
);
CREATE UNIQUE INDEX storage_policy_one_active
  ON sf_storage.storage_policy (tenant_id)
  WHERE status = 'ACTIVE';
ALTER TABLE sf_storage.storage_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_storage.storage_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY storage_policy_tenant ON sf_storage.storage_policy TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_storage.storage_policy OWNER TO sf_migrator;

-- sf:isolation sf_storage.object_metadata TENANT_SCOPED owner=CMP-032
CREATE TABLE sf_storage.object_metadata (
  object_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  object_key text NOT NULL CHECK (char_length(object_key) BETWEEN 1 AND 1024),
  content_type text NOT NULL CHECK (char_length(content_type) BETWEEN 1 AND 200),
  byte_size bigint NOT NULL CHECK (byte_size >= 0 AND byte_size <= 104857600),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  encryption_algorithm text NOT NULL CHECK (encryption_algorithm IN ('AES_256_GCM')),
  kms_key_ref text NOT NULL,
  wrapped_dek text NOT NULL CHECK (char_length(wrapped_dek) BETWEEN 1 AND 4096),
  kms_key_version text NOT NULL CHECK (char_length(kms_key_version) BETWEEN 1 AND 64),
  encryption_context jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (octet_length(encryption_context::text) <= 8192),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED', 'DELETED')),
  storage_mode text NOT NULL CHECK (storage_mode IN ('SIMULATED', 'LOCAL')),
  environment text NOT NULL CHECK (environment IN (
    'LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE', 'UAT', 'PREPROD', 'PRODUCTION'
  )),
  simulation jsonb,
  policy_id uuid NOT NULL,
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (tenant_id, object_id),
  UNIQUE (tenant_id, object_key),
  FOREIGN KEY (tenant_id, policy_id)
    REFERENCES sf_storage.storage_policy (tenant_id, policy_id),
  CHECK (storage_mode <> 'SIMULATED' OR simulation IS NOT NULL),
  CHECK (
    storage_mode <> 'SIMULATED'
    OR environment IN ('LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE')
  )
);
CREATE INDEX object_metadata_tenant_status_idx
  ON sf_storage.object_metadata (tenant_id, status, created_at DESC);
ALTER TABLE sf_storage.object_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_storage.object_metadata FORCE ROW LEVEL SECURITY;
CREATE POLICY object_metadata_tenant ON sf_storage.object_metadata TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_storage.object_metadata OWNER TO sf_migrator;

-- sf:isolation sf_storage.idempotency_record TENANT_SCOPED owner=CMP-032
CREATE TABLE sf_storage.idempotency_record (
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
ALTER TABLE sf_storage.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_storage.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_tenant ON sf_storage.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_storage.idempotency_record OWNER TO sf_migrator;

GRANT SELECT, INSERT, UPDATE (status, version, updated_at) ON sf_storage.storage_policy TO sf_cmp032_rw;
GRANT SELECT, INSERT, UPDATE (
  status, aggregate_version, archived_at, deleted_at, simulation
) ON sf_storage.object_metadata TO sf_cmp032_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (
  status, response_ref, response_status, response_body
) ON sf_storage.idempotency_record TO sf_cmp032_rw;

REVOKE ALL ON sf_storage.storage_policy FROM PUBLIC;
REVOKE ALL ON sf_storage.object_metadata FROM PUBLIC;
REVOKE ALL ON sf_storage.idempotency_record FROM PUBLIC;

-- Down Migration
DROP TABLE IF EXISTS sf_storage.idempotency_record;
DROP TABLE IF EXISTS sf_storage.object_metadata;
DROP TABLE IF EXISTS sf_storage.storage_policy;
DROP SCHEMA IF EXISTS sf_storage;
-- Role sf_cmp032_rw retained (may be referenced by runtime logins); never DROP ROLE here.
