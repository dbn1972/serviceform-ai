-- ServiceForm AI CMP-013 Document Upload Service schema (ADR-0006 Option A).
-- Schema sf_upload owned by sf_migrator. DML via sf_cmp013_rw. RLS policies TO sf_app.
-- File bytes never live in PostgreSQL (Constitution #5): object_ref is an opaque CMP-032 storage
-- key reached only through the storage port. No cross-schema FK/SQL (Constitution #23).
-- Upload policies are insert-only metadata versions (Constitution #8); sessions pin a policy row.
-- A document reaches AVAILABLE only after a CLEAN scan row exists (unscanned/infected never usable).

-- Up Migration

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_migrator') THEN
    CREATE ROLE sf_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_migrator IS 'Deployment/migration role. Owns authoritative schemas/tables. Never a runtime login.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp013_rw') THEN
    CREATE ROLE sf_cmp013_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp013_rw IS 'CMP-013 privilege role (ADR-0006). NOLOGIN. Holds DML on sf_upload business tables.';

CREATE SCHEMA sf_upload AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_upload IS 'isolation_class=TENANT_SCOPED; owner=CMP-013; Upload policies, sessions, document metadata and scan state';

REVOKE ALL ON SCHEMA sf_upload FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_upload TO sf_cmp013_rw;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_upload REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_upload REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_upload REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- sf:isolation sf_upload.upload_policy TENANT_SCOPED owner=CMP-013
CREATE TABLE sf_upload.upload_policy (
  tenant_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  policy_code text NOT NULL CHECK (policy_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  version_no bigint NOT NULL CHECK (version_no >= 1),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  allowed_content_types text[] NOT NULL
    CHECK (cardinality(allowed_content_types) BETWEEN 1 AND 16),
  max_bytes bigint NOT NULL CHECK (max_bytes BETWEEN 1 AND 5368709120),
  session_ttl_seconds integer NOT NULL CHECK (session_ttl_seconds BETWEEN 60 AND 86400),
  max_scan_attempts integer NOT NULL CHECK (max_scan_attempts BETWEEN 1 AND 10),
  classification text NOT NULL CHECK (classification IN ('TENANT_SCOPED', 'CITIZEN_PRIVATE')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, policy_id),
  UNIQUE (tenant_id, policy_code, version_no)
);
ALTER TABLE sf_upload.upload_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_upload.upload_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY upload_policy_isolation ON sf_upload.upload_policy TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_upload.upload_policy OWNER TO sf_migrator;

-- sf:isolation sf_upload.document_metadata TENANT_SCOPED owner=CMP-013
CREATE TABLE sf_upload.document_metadata (
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  policy_id uuid NOT NULL,
  classification text NOT NULL CHECK (classification IN ('TENANT_SCOPED', 'CITIZEN_PRIVATE')),
  application_ref uuid,
  owner_actor_id uuid NOT NULL,
  owner_actor_type text NOT NULL
    CHECK (owner_actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  declared_content_type text NOT NULL CHECK (char_length(declared_content_type) BETWEEN 3 AND 100),
  declared_byte_size bigint NOT NULL CHECK (declared_byte_size >= 1),
  declared_checksum_sha256 text NOT NULL CHECK (declared_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  detected_content_type text CHECK (detected_content_type IS NULL OR char_length(detected_content_type) BETWEEN 3 AND 100),
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 1),
  checksum_sha256 text CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
  object_ref text NOT NULL CHECK (
    char_length(object_ref) BETWEEN 1 AND 512
    AND object_ref ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$'
  ),
  storage_mode text NOT NULL CHECK (storage_mode IN ('REAL', 'SANDBOX', 'SIMULATED')),
  storage_simulation jsonb,
  status text NOT NULL CHECK (status IN ('PENDING_UPLOAD', 'SCAN_PENDING', 'AVAILABLE', 'REJECTED')),
  rejection_code text CHECK (rejection_code IS NULL OR rejection_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  scan_attempts integer NOT NULL DEFAULT 0 CHECK (scan_attempts >= 0),
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, document_id),
  UNIQUE (tenant_id, object_ref),
  FOREIGN KEY (tenant_id, policy_id) REFERENCES sf_upload.upload_policy (tenant_id, policy_id),
  CHECK (status <> 'REJECTED' OR rejection_code IS NOT NULL),
  CHECK (status NOT IN ('SCAN_PENDING', 'AVAILABLE')
         OR (checksum_sha256 IS NOT NULL AND byte_size IS NOT NULL AND detected_content_type IS NOT NULL)),
  CHECK (storage_mode <> 'SIMULATED' OR storage_simulation IS NOT NULL)
);
CREATE INDEX document_metadata_application_idx
  ON sf_upload.document_metadata (tenant_id, application_ref) WHERE application_ref IS NOT NULL;
ALTER TABLE sf_upload.document_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_upload.document_metadata FORCE ROW LEVEL SECURITY;
CREATE POLICY document_metadata_isolation ON sf_upload.document_metadata TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_upload.document_metadata OWNER TO sf_migrator;

-- sf:isolation sf_upload.upload_session TENANT_SCOPED owner=CMP-013
CREATE TABLE sf_upload.upload_session (
  tenant_id uuid NOT NULL,
  session_id uuid NOT NULL,
  document_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN', 'COMPLETED', 'EXPIRED', 'REJECTED')),
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  PRIMARY KEY (tenant_id, session_id),
  UNIQUE (tenant_id, document_id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES sf_upload.document_metadata (tenant_id, document_id),
  CHECK (expires_at > created_at),
  CHECK ((status = 'OPEN') = (closed_at IS NULL))
);
CREATE INDEX upload_session_open_expiry_idx
  ON sf_upload.upload_session (tenant_id, expires_at) WHERE status = 'OPEN';
ALTER TABLE sf_upload.upload_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_upload.upload_session FORCE ROW LEVEL SECURITY;
CREATE POLICY upload_session_isolation ON sf_upload.upload_session TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_upload.upload_session OWNER TO sf_migrator;

-- sf:isolation sf_upload.document_scan_status TENANT_SCOPED owner=CMP-013
CREATE TABLE sf_upload.document_scan_status (
  tenant_id uuid NOT NULL,
  scan_id uuid NOT NULL,
  document_id uuid NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no >= 1),
  verdict text NOT NULL CHECK (verdict IN ('CLEAN', 'INFECTED', 'ERROR')),
  engine_ref text NOT NULL CHECK (engine_ref ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  scanner_mode text NOT NULL CHECK (scanner_mode IN ('REAL', 'SANDBOX', 'SIMULATED')),
  simulation jsonb,
  scanned_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, scan_id),
  UNIQUE (tenant_id, document_id, attempt_no),
  FOREIGN KEY (tenant_id, document_id) REFERENCES sf_upload.document_metadata (tenant_id, document_id),
  CHECK (scanner_mode <> 'SIMULATED' OR simulation IS NOT NULL)
);
ALTER TABLE sf_upload.document_scan_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_upload.document_scan_status FORCE ROW LEVEL SECURITY;
CREATE POLICY document_scan_status_isolation ON sf_upload.document_scan_status TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_upload.document_scan_status OWNER TO sf_migrator;

-- sf:isolation sf_upload.idempotency_record TENANT_SCOPED owner=CMP-013
CREATE TABLE sf_upload.idempotency_record (
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
ALTER TABLE sf_upload.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_upload.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_upload.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_upload.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_upload.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_upload, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'insert-only upload row'
    USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_upload.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER upload_policy_immutable
  BEFORE UPDATE OR DELETE ON sf_upload.upload_policy
  FOR EACH ROW
  EXECUTE FUNCTION sf_upload.reject_mutation();

CREATE TRIGGER document_scan_status_immutable
  BEFORE UPDATE OR DELETE ON sf_upload.document_scan_status
  FOR EACH ROW
  EXECUTE FUNCTION sf_upload.reject_mutation();

CREATE FUNCTION sf_upload.guard_document_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_upload, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING_UPLOAD' THEN
      RAISE EXCEPTION 'document must start PENDING_UPLOAD';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.object_ref IS DISTINCT FROM OLD.object_ref
     OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
     OR NEW.owner_actor_id IS DISTINCT FROM OLD.owner_actor_id THEN
    RAISE EXCEPTION 'document identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF NOT (
       (OLD.status = 'PENDING_UPLOAD' AND NEW.status IN ('SCAN_PENDING', 'REJECTED'))
    OR (OLD.status = 'SCAN_PENDING' AND NEW.status IN ('SCAN_PENDING', 'AVAILABLE', 'REJECTED'))
  ) THEN
    RAISE EXCEPTION 'document transition % -> % refused', OLD.status, NEW.status;
  END IF;
  IF OLD.status = 'SCAN_PENDING'
     AND (NEW.checksum_sha256 IS DISTINCT FROM OLD.checksum_sha256
          OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
          OR NEW.detected_content_type IS DISTINCT FROM OLD.detected_content_type) THEN
    RAISE EXCEPTION 'observed integrity fields are immutable once recorded' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'AVAILABLE' AND NOT EXISTS (
       SELECT 1 FROM sf_upload.document_scan_status s
        WHERE s.tenant_id = NEW.tenant_id
          AND s.document_id = NEW.document_id
          AND s.verdict = 'CLEAN'
     ) THEN
    RAISE EXCEPTION 'document cannot become AVAILABLE without a CLEAN scan';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_upload.guard_document_transition() OWNER TO sf_migrator;

CREATE TRIGGER document_metadata_transition_guard
  BEFORE INSERT OR UPDATE ON sf_upload.document_metadata
  FOR EACH ROW
  EXECUTE FUNCTION sf_upload.guard_document_transition();

CREATE TRIGGER document_metadata_no_delete
  BEFORE DELETE ON sf_upload.document_metadata
  FOR EACH ROW
  EXECUTE FUNCTION sf_upload.reject_mutation();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_upload FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_upload FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_upload FROM PUBLIC;

GRANT SELECT, INSERT ON sf_upload.upload_policy TO sf_cmp013_rw;
GRANT SELECT, INSERT,
  UPDATE (status, detected_content_type, byte_size, checksum_sha256, rejection_code,
          scan_attempts, aggregate_version, updated_at)
  ON sf_upload.document_metadata TO sf_cmp013_rw;
GRANT SELECT, INSERT, UPDATE (status, closed_at) ON sf_upload.upload_session TO sf_cmp013_rw;
GRANT SELECT, INSERT ON sf_upload.document_scan_status TO sf_cmp013_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_upload.idempotency_record TO sf_cmp013_rw;

GRANT EXECUTE ON FUNCTION sf_upload.reject_mutation() TO sf_cmp013_rw;
GRANT EXECUTE ON FUNCTION sf_upload.guard_document_transition() TO sf_cmp013_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_upload FROM sf_cmp013_rw;
DROP SCHEMA IF EXISTS sf_upload CASCADE;
DROP ROLE IF EXISTS sf_cmp013_rw;
