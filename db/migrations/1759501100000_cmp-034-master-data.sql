-- ServiceForm AI CMP-034 Master Data Service schema (ADR-0006 Option A).
-- Schema sf_master_data owned by sf_migrator. DML via sf_cmp034_rw. RLS policies TO sf_app.
-- No cross-schema FK/SQL. No named-service / geographic-level branching.

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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp034_rw') THEN
    CREATE ROLE sf_cmp034_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp034_rw IS 'CMP-034 privilege role (ADR-0006). NOLOGIN. Holds DML on sf_master_data business tables.';

CREATE SCHEMA sf_master_data AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_master_data IS 'isolation_class=TENANT_SCOPED; owner=CMP-034; Versioned generic code sets';

REVOKE ALL ON SCHEMA sf_master_data FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_master_data TO sf_cmp034_rw;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_master_data REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_master_data REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_master_data REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- sf:isolation sf_master_data.code_set TENANT_SCOPED owner=CMP-034
CREATE TABLE sf_master_data.code_set (
  tenant_id uuid NOT NULL,
  code_set_id uuid NOT NULL,
  set_code text NOT NULL CHECK (set_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  localization_key text NOT NULL CHECK (char_length(localization_key) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  PRIMARY KEY (tenant_id, code_set_id),
  UNIQUE (tenant_id, set_code)
);
ALTER TABLE sf_master_data.code_set ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_master_data.code_set FORCE ROW LEVEL SECURITY;
CREATE POLICY code_set_isolation ON sf_master_data.code_set TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_master_data.code_set OWNER TO sf_migrator;

-- sf:isolation sf_master_data.code_set_version TENANT_SCOPED owner=CMP-034
CREATE TABLE sf_master_data.code_set_version (
  tenant_id uuid NOT NULL,
  code_set_id uuid NOT NULL,
  version_no bigint NOT NULL CHECK (version_no >= 1),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED')),
  valid_from timestamptz NOT NULL,
  jurisdiction_ref text CHECK (jurisdiction_ref IS NULL OR char_length(jurisdiction_ref) BETWEEN 1 AND 200),
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 1000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, code_set_id, version_no),
  UNIQUE (tenant_id, code_set_id, valid_from),
  FOREIGN KEY (tenant_id, code_set_id)
    REFERENCES sf_master_data.code_set (tenant_id, code_set_id)
);
CREATE INDEX code_set_version_as_of_idx
  ON sf_master_data.code_set_version (tenant_id, code_set_id, valid_from DESC);
ALTER TABLE sf_master_data.code_set_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_master_data.code_set_version FORCE ROW LEVEL SECURITY;
CREATE POLICY code_set_version_isolation ON sf_master_data.code_set_version TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_master_data.code_set_version OWNER TO sf_migrator;

-- sf:isolation sf_master_data.code_value TENANT_SCOPED owner=CMP-034
CREATE TABLE sf_master_data.code_value (
  tenant_id uuid NOT NULL,
  code_set_id uuid NOT NULL,
  version_no bigint NOT NULL,
  value_id uuid NOT NULL,
  value_code text NOT NULL CHECK (value_code ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
  localization_key text NOT NULL CHECK (char_length(localization_key) BETWEEN 1 AND 200),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  parent_value_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, code_set_id, version_no, value_id),
  UNIQUE (tenant_id, code_set_id, version_no, value_code),
  CHECK (parent_value_id IS NULL OR parent_value_id <> value_id),
  FOREIGN KEY (tenant_id, code_set_id, version_no)
    REFERENCES sf_master_data.code_set_version (tenant_id, code_set_id, version_no),
  FOREIGN KEY (tenant_id, code_set_id, version_no, parent_value_id)
    REFERENCES sf_master_data.code_value (tenant_id, code_set_id, version_no, value_id)
);
CREATE INDEX code_value_lookup_idx
  ON sf_master_data.code_value (tenant_id, code_set_id, version_no, value_code);
ALTER TABLE sf_master_data.code_value ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_master_data.code_value FORCE ROW LEVEL SECURITY;
CREATE POLICY code_value_isolation ON sf_master_data.code_value TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_master_data.code_value OWNER TO sf_migrator;

-- sf:isolation sf_master_data.code_set_binding TENANT_SCOPED owner=CMP-034
-- Opaque target refs only — no FK to catalogue/forms/jurisdiction (no cross-component SQL).
CREATE TABLE sf_master_data.code_set_binding (
  binding_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  code_set_id uuid NOT NULL,
  pinned_version_no bigint NOT NULL,
  target_type text NOT NULL CHECK (target_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  target_ref text NOT NULL CHECK (char_length(target_ref) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  valid_from timestamptz NOT NULL,
  version_no bigint NOT NULL CHECK (version_no >= 1),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, target_type, target_ref, version_no),
  FOREIGN KEY (tenant_id, code_set_id, pinned_version_no)
    REFERENCES sf_master_data.code_set_version (tenant_id, code_set_id, version_no)
);
CREATE INDEX code_set_binding_lookup_idx
  ON sf_master_data.code_set_binding (tenant_id, target_type, target_ref, valid_from DESC);
ALTER TABLE sf_master_data.code_set_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_master_data.code_set_binding FORCE ROW LEVEL SECURITY;
CREATE POLICY code_set_binding_isolation ON sf_master_data.code_set_binding TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_master_data.code_set_binding OWNER TO sf_migrator;

-- sf:isolation sf_master_data.import_job TENANT_SCOPED owner=CMP-034
CREATE TABLE sf_master_data.import_job (
  tenant_id uuid NOT NULL,
  import_id uuid NOT NULL,
  code_set_id uuid NOT NULL,
  version_no bigint NOT NULL,
  source_mode text NOT NULL CHECK (source_mode IN ('INLINE', 'CONNECTOR')),
  connector_binding_id uuid,
  simulation jsonb,
  item_count integer NOT NULL CHECK (item_count >= 0 AND item_count <= 500),
  status text NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, import_id),
  FOREIGN KEY (tenant_id, code_set_id, version_no)
    REFERENCES sf_master_data.code_set_version (tenant_id, code_set_id, version_no)
);
ALTER TABLE sf_master_data.import_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_master_data.import_job FORCE ROW LEVEL SECURITY;
CREATE POLICY import_job_isolation ON sf_master_data.import_job TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_master_data.import_job OWNER TO sf_migrator;

-- sf:isolation sf_master_data.idempotency_record TENANT_SCOPED owner=CMP-034
CREATE TABLE sf_master_data.idempotency_record (
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
ALTER TABLE sf_master_data.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_master_data.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_master_data.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_master_data.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_master_data.enforce_version_publish_machine()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_master_data, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'code set version insert must be DRAFT'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'PUBLISHED' THEN
      RAISE EXCEPTION 'published code set version is immutable'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.status NOT IN ('DRAFT', 'PUBLISHED') THEN
      RAISE EXCEPTION 'code set version status is invalid'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.code_set_id IS DISTINCT FROM OLD.code_set_id
       OR NEW.version_no IS DISTINCT FROM OLD.version_no
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'code set version identity fields are immutable'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'code set version delete is not permitted' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER code_set_version_publish_machine
  BEFORE INSERT OR UPDATE OR DELETE ON sf_master_data.code_set_version
  FOR EACH ROW
  EXECUTE FUNCTION sf_master_data.enforce_version_publish_machine();
ALTER FUNCTION sf_master_data.enforce_version_publish_machine() OWNER TO sf_migrator;

CREATE FUNCTION sf_master_data.enforce_published_values_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_master_data, pg_temp
AS $$
DECLARE
  v_status text;
  v_set uuid;
  v_no bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_set := OLD.code_set_id;
    v_no := OLD.version_no;
  ELSE
    v_set := NEW.code_set_id;
    v_no := NEW.version_no;
  END IF;
  SELECT status INTO v_status
    FROM sf_master_data.code_set_version
   WHERE code_set_id = v_set AND version_no = v_no;
  IF v_status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'published code values are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER code_value_published_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON sf_master_data.code_value
  FOR EACH ROW
  EXECUTE FUNCTION sf_master_data.enforce_published_values_immutable();
ALTER FUNCTION sf_master_data.enforce_published_values_immutable() OWNER TO sf_migrator;

CREATE FUNCTION sf_master_data.enforce_binding_pins_published()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_master_data, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
    FROM sf_master_data.code_set_version
   WHERE code_set_id = NEW.code_set_id AND version_no = NEW.pinned_version_no;
  IF v_status IS DISTINCT FROM 'PUBLISHED' THEN
    RAISE EXCEPTION 'bindings may pin only published versions'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER code_set_binding_pin_published
  BEFORE INSERT OR UPDATE ON sf_master_data.code_set_binding
  FOR EACH ROW
  EXECUTE FUNCTION sf_master_data.enforce_binding_pins_published();
ALTER FUNCTION sf_master_data.enforce_binding_pins_published() OWNER TO sf_migrator;

REVOKE ALL ON ALL TABLES IN SCHEMA sf_master_data FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_master_data FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_master_data FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE (status) ON sf_master_data.code_set TO sf_cmp034_rw;
GRANT SELECT, INSERT, UPDATE (status, valid_from, jurisdiction_ref, reason) ON sf_master_data.code_set_version TO sf_cmp034_rw;
GRANT SELECT, INSERT, DELETE ON sf_master_data.code_value TO sf_cmp034_rw;
GRANT SELECT, INSERT ON sf_master_data.code_set_binding TO sf_cmp034_rw;
GRANT SELECT, INSERT ON sf_master_data.import_job TO sf_cmp034_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_master_data.idempotency_record TO sf_cmp034_rw;
GRANT EXECUTE ON FUNCTION sf_master_data.enforce_version_publish_machine() TO sf_cmp034_rw;
GRANT EXECUTE ON FUNCTION sf_master_data.enforce_published_values_immutable() TO sf_cmp034_rw;
GRANT EXECUTE ON FUNCTION sf_master_data.enforce_binding_pins_published() TO sf_cmp034_rw;

ALTER TABLE sf_master_data.code_set ALTER COLUMN localization_key SET STATISTICS 0;
ALTER TABLE sf_master_data.code_value ALTER COLUMN localization_key SET STATISTICS 0;
ALTER TABLE sf_master_data.code_set_version ALTER COLUMN jurisdiction_ref SET STATISTICS 0;
ALTER TABLE sf_master_data.code_set_version ALTER COLUMN reason SET STATISTICS 0;
ALTER TABLE sf_master_data.code_set_binding ALTER COLUMN target_ref SET STATISTICS 0;

-- Down Migration
REVOKE ALL ON SCHEMA sf_master_data FROM sf_cmp034_rw;
DROP SCHEMA IF EXISTS sf_master_data CASCADE;
DROP ROLE IF EXISTS sf_cmp034_rw;
