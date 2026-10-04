-- ServiceForm AI CMP-001 Service Catalogue & Registry schema (ADR-0006 Option A).
-- Schema sf_catalogue owned by sf_migrator. DML via sf_cmp001_rw. RLS policies TO sf_app.
-- No cross-schema FK/SQL. Provider/jurisdiction targets are opaque refs (CMP-002/003 ports later).
-- Published pins are insert-once; this component does not mutate published versions (Constitution #8).

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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp001_rw') THEN
    CREATE ROLE sf_cmp001_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp001_rw IS 'CMP-001 privilege role (ADR-0006). NOLOGIN. Holds DML on sf_catalogue business tables.';

CREATE SCHEMA sf_catalogue AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_catalogue IS 'isolation_class=mixed; owner=CMP-001; Canonical services and tenant offerings';

REVOKE ALL ON SCHEMA sf_catalogue FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_catalogue TO sf_cmp001_rw;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_catalogue REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_catalogue REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_catalogue REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- sf:isolation sf_catalogue.category GLOBAL owner=CMP-001
CREATE TABLE sf_catalogue.category (
  category_id uuid PRIMARY KEY,
  category_code text NOT NULL UNIQUE CHECK (category_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  display_label text NOT NULL CHECK (char_length(display_label) BETWEEN 1 AND 200),
  parent_category_id uuid REFERENCES sf_catalogue.category (category_id),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  CHECK (parent_category_id IS DISTINCT FROM category_id)
);
ALTER TABLE sf_catalogue.category OWNER TO sf_migrator;

-- sf:isolation sf_catalogue.canonical_service GLOBAL owner=CMP-001
CREATE TABLE sf_catalogue.canonical_service (
  canonical_service_id uuid PRIMARY KEY,
  service_code text NOT NULL UNIQUE CHECK (service_code ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  category_id uuid NOT NULL REFERENCES sf_catalogue.category (category_id),
  status text NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
ALTER TABLE sf_catalogue.canonical_service OWNER TO sf_migrator;

-- sf:isolation sf_catalogue.canonical_service_version GLOBAL owner=CMP-001
CREATE TABLE sf_catalogue.canonical_service_version (
  canonical_service_id uuid NOT NULL REFERENCES sf_catalogue.canonical_service (canonical_service_id),
  version_no bigint NOT NULL CHECK (version_no >= 1),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 2000),
  tags text[] NOT NULL DEFAULT ARRAY[]::text[] CHECK (cardinality(tags) <= 32),
  status text NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  valid_from timestamptz NOT NULL,
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 1000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (canonical_service_id, version_no),
  UNIQUE (canonical_service_id, valid_from)
);
CREATE INDEX canonical_service_version_as_of_idx
  ON sf_catalogue.canonical_service_version (canonical_service_id, valid_from DESC);
ALTER TABLE sf_catalogue.canonical_service_version OWNER TO sf_migrator;

-- sf:isolation sf_catalogue.offering TENANT_SCOPED owner=CMP-001
CREATE TABLE sf_catalogue.offering (
  tenant_id uuid NOT NULL,
  offering_id uuid NOT NULL,
  canonical_service_id uuid NOT NULL REFERENCES sf_catalogue.canonical_service (canonical_service_id),
  offering_code text NOT NULL CHECK (offering_code ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  PRIMARY KEY (tenant_id, offering_id),
  UNIQUE (tenant_id, offering_code)
);
CREATE INDEX offering_canonical_idx ON sf_catalogue.offering (tenant_id, canonical_service_id);
ALTER TABLE sf_catalogue.offering ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_catalogue.offering FORCE ROW LEVEL SECURITY;
CREATE POLICY offering_isolation ON sf_catalogue.offering TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_catalogue.offering OWNER TO sf_migrator;

-- sf:isolation sf_catalogue.offering_version TENANT_SCOPED owner=CMP-001
CREATE TABLE sf_catalogue.offering_version (
  tenant_id uuid NOT NULL,
  offering_id uuid NOT NULL,
  version_no bigint NOT NULL CHECK (version_no >= 1),
  local_name text NOT NULL CHECK (char_length(local_name) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('DRAFT', 'READY', 'RETIRED')),
  provider_org_ref text CHECK (provider_org_ref IS NULL OR char_length(provider_org_ref) BETWEEN 1 AND 200),
  provider_office_ref text CHECK (provider_office_ref IS NULL OR char_length(provider_office_ref) BETWEEN 1 AND 200),
  tags text[] NOT NULL DEFAULT ARRAY[]::text[] CHECK (cardinality(tags) <= 32),
  published_pin_ref text CHECK (published_pin_ref IS NULL OR char_length(published_pin_ref) BETWEEN 1 AND 200),
  valid_from timestamptz NOT NULL,
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 1000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, offering_id, version_no),
  UNIQUE (tenant_id, offering_id, valid_from),
  FOREIGN KEY (tenant_id, offering_id) REFERENCES sf_catalogue.offering (tenant_id, offering_id)
);
CREATE INDEX offering_version_as_of_idx
  ON sf_catalogue.offering_version (tenant_id, offering_id, valid_from DESC);
CREATE INDEX offering_version_tags_idx ON sf_catalogue.offering_version USING gin (tags);
ALTER TABLE sf_catalogue.offering_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_catalogue.offering_version FORCE ROW LEVEL SECURITY;
CREATE POLICY offering_version_isolation ON sf_catalogue.offering_version TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_catalogue.offering_version OWNER TO sf_migrator;

-- sf:isolation sf_catalogue.offering_binding TENANT_SCOPED owner=CMP-001
-- Opaque jurisdiction/org/office refs — no FK to CMP-002/003 (Constitution #23).
CREATE TABLE sf_catalogue.offering_binding (
  binding_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  offering_id uuid NOT NULL,
  version_no bigint NOT NULL CHECK (version_no >= 1),
  jurisdiction_ref text NOT NULL CHECK (char_length(jurisdiction_ref) BETWEEN 1 AND 200),
  target_type text NOT NULL CHECK (target_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  target_ref text NOT NULL CHECK (char_length(target_ref) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  valid_from timestamptz NOT NULL,
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 1000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, offering_id, target_type, target_ref, version_no),
  FOREIGN KEY (tenant_id, offering_id, version_no)
    REFERENCES sf_catalogue.offering_version (tenant_id, offering_id, version_no)
);
CREATE INDEX offering_binding_lookup_idx
  ON sf_catalogue.offering_binding (tenant_id, offering_id, valid_from DESC);
ALTER TABLE sf_catalogue.offering_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_catalogue.offering_binding FORCE ROW LEVEL SECURITY;
CREATE POLICY offering_binding_isolation ON sf_catalogue.offering_binding TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_catalogue.offering_binding OWNER TO sf_migrator;

-- sf:isolation sf_catalogue.idempotency_record TENANT_SCOPED owner=CMP-001
CREATE TABLE sf_catalogue.idempotency_record (
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
ALTER TABLE sf_catalogue.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_catalogue.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_catalogue.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_catalogue.idempotency_record OWNER TO sf_migrator;

-- sf:isolation sf_catalogue.idempotency_record_platform PLATFORM_OPERATIONAL owner=CMP-001
CREATE TABLE sf_catalogue.idempotency_record_platform (
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
  PRIMARY KEY (principal_id, endpoint, idempotency_key)
);
ALTER TABLE sf_catalogue.idempotency_record_platform ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_catalogue.idempotency_record_platform FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_platform_actor ON sf_catalogue.idempotency_record_platform TO sf_app
  USING (principal_id = sf_platform.current_actor_id())
  WITH CHECK (principal_id = sf_platform.current_actor_id());
ALTER TABLE sf_catalogue.idempotency_record_platform OWNER TO sf_migrator;

CREATE FUNCTION sf_catalogue.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_catalogue, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'insert-only catalogue row'
    USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_catalogue.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER canonical_service_version_immutable
  BEFORE UPDATE OR DELETE ON sf_catalogue.canonical_service_version
  FOR EACH ROW
  EXECUTE FUNCTION sf_catalogue.reject_mutation();

CREATE TRIGGER offering_version_immutable
  BEFORE UPDATE OR DELETE ON sf_catalogue.offering_version
  FOR EACH ROW
  EXECUTE FUNCTION sf_catalogue.reject_mutation();

CREATE TRIGGER offering_binding_immutable
  BEFORE UPDATE OR DELETE ON sf_catalogue.offering_binding
  FOR EACH ROW
  EXECUTE FUNCTION sf_catalogue.reject_mutation();

CREATE FUNCTION sf_catalogue.enforce_offering_version_pin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_catalogue, pg_temp
AS $$
BEGIN
  IF NEW.published_pin_ref IS NOT NULL
     AND current_setting('app.privileged_marker', true) IS DISTINCT FROM 'CATALOGUE_PIN' THEN
    RAISE EXCEPTION 'published pin requires privileged marker'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_catalogue.enforce_offering_version_pin() OWNER TO sf_migrator;

CREATE TRIGGER offering_version_pin_guard
  BEFORE INSERT ON sf_catalogue.offering_version
  FOR EACH ROW
  EXECUTE FUNCTION sf_catalogue.enforce_offering_version_pin();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_catalogue FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_catalogue FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_catalogue FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE (display_label, status) ON sf_catalogue.category TO sf_cmp001_rw;
GRANT SELECT, INSERT, UPDATE (status) ON sf_catalogue.canonical_service TO sf_cmp001_rw;
GRANT SELECT, INSERT ON sf_catalogue.canonical_service_version TO sf_cmp001_rw;
GRANT SELECT, INSERT ON sf_catalogue.offering TO sf_cmp001_rw;
GRANT SELECT, INSERT ON sf_catalogue.offering_version TO sf_cmp001_rw;
GRANT SELECT, INSERT ON sf_catalogue.offering_binding TO sf_cmp001_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_catalogue.idempotency_record TO sf_cmp001_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_catalogue.idempotency_record_platform TO sf_cmp001_rw;

GRANT EXECUTE ON FUNCTION sf_catalogue.reject_mutation() TO sf_cmp001_rw;
GRANT EXECUTE ON FUNCTION sf_catalogue.enforce_offering_version_pin() TO sf_cmp001_rw;

ALTER TABLE sf_catalogue.category ALTER COLUMN display_label SET STATISTICS 0;
ALTER TABLE sf_catalogue.canonical_service_version ALTER COLUMN title SET STATISTICS 0;
ALTER TABLE sf_catalogue.canonical_service_version ALTER COLUMN summary SET STATISTICS 0;
ALTER TABLE sf_catalogue.offering_version ALTER COLUMN local_name SET STATISTICS 0;
ALTER TABLE sf_catalogue.offering_binding ALTER COLUMN target_ref SET STATISTICS 0;
ALTER TABLE sf_catalogue.offering_binding ALTER COLUMN jurisdiction_ref SET STATISTICS 0;

-- Down Migration
REVOKE ALL ON SCHEMA sf_catalogue FROM sf_cmp001_rw;
DROP SCHEMA IF EXISTS sf_catalogue CASCADE;
DROP ROLE IF EXISTS sf_cmp001_rw;
