-- ServiceForm AI CMP-003 Jurisdiction Engine schema (ADR-0006 Option A).
-- Schema sf_jurisdiction owned by sf_migrator. DML via sf_cmp003_rw. RLS policies TO sf_app.
-- Organisation hierarchy (CMP-002) is not owned here. No cross-schema FK/SQL.

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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp003_rw') THEN
    CREATE ROLE sf_cmp003_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp003_rw IS 'CMP-003 privilege role (ADR-0006). NOLOGIN. Holds DML on sf_jurisdiction business tables.';

CREATE SCHEMA sf_jurisdiction AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_jurisdiction IS 'isolation_class=TENANT_SCOPED; owner=CMP-003; Versioned geographic/administrative jurisdiction';

REVOKE ALL ON SCHEMA sf_jurisdiction FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_jurisdiction TO sf_cmp003_rw;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_jurisdiction REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_jurisdiction REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_jurisdiction REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- sf:isolation sf_jurisdiction.jurisdiction_type TENANT_SCOPED owner=CMP-003
CREATE TABLE sf_jurisdiction.jurisdiction_type (
  tenant_id uuid NOT NULL,
  jurisdiction_type_id uuid NOT NULL,
  type_code text NOT NULL CHECK (type_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  display_label text NOT NULL CHECK (char_length(display_label) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  PRIMARY KEY (tenant_id, jurisdiction_type_id),
  UNIQUE (tenant_id, type_code)
);
ALTER TABLE sf_jurisdiction.jurisdiction_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_jurisdiction.jurisdiction_type FORCE ROW LEVEL SECURITY;
CREATE POLICY jurisdiction_type_isolation ON sf_jurisdiction.jurisdiction_type TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_jurisdiction.jurisdiction_type OWNER TO sf_migrator;

-- sf:isolation sf_jurisdiction.jurisdiction TENANT_SCOPED owner=CMP-003
CREATE TABLE sf_jurisdiction.jurisdiction (
  tenant_id uuid NOT NULL,
  jurisdiction_id uuid NOT NULL,
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  PRIMARY KEY (tenant_id, jurisdiction_id),
  UNIQUE (tenant_id, code)
);
ALTER TABLE sf_jurisdiction.jurisdiction ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_jurisdiction.jurisdiction FORCE ROW LEVEL SECURITY;
CREATE POLICY jurisdiction_isolation ON sf_jurisdiction.jurisdiction TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_jurisdiction.jurisdiction OWNER TO sf_migrator;

-- sf:isolation sf_jurisdiction.jurisdiction_version TENANT_SCOPED owner=CMP-003
CREATE TABLE sf_jurisdiction.jurisdiction_version (
  tenant_id uuid NOT NULL,
  jurisdiction_id uuid NOT NULL,
  version_no bigint NOT NULL CHECK (version_no >= 1),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  jurisdiction_type_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  valid_from timestamptz NOT NULL,
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 1000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, jurisdiction_id, version_no),
  UNIQUE (tenant_id, jurisdiction_id, valid_from),
  FOREIGN KEY (tenant_id, jurisdiction_id)
    REFERENCES sf_jurisdiction.jurisdiction (tenant_id, jurisdiction_id),
  FOREIGN KEY (tenant_id, jurisdiction_type_id)
    REFERENCES sf_jurisdiction.jurisdiction_type (tenant_id, jurisdiction_type_id)
);
CREATE INDEX jurisdiction_version_as_of_idx
  ON sf_jurisdiction.jurisdiction_version (tenant_id, jurisdiction_id, valid_from DESC);
ALTER TABLE sf_jurisdiction.jurisdiction_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_jurisdiction.jurisdiction_version FORCE ROW LEVEL SECURITY;
CREATE POLICY jurisdiction_version_isolation ON sf_jurisdiction.jurisdiction_version TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_jurisdiction.jurisdiction_version OWNER TO sf_migrator;

-- sf:isolation sf_jurisdiction.jurisdiction_relation TENANT_SCOPED owner=CMP-003
CREATE TABLE sf_jurisdiction.jurisdiction_relation (
  relation_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  child_jurisdiction_id uuid NOT NULL,
  parent_jurisdiction_id uuid,
  relation_type_code text NOT NULL CHECK (relation_type_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  version_no bigint NOT NULL CHECK (version_no >= 1),
  valid_from timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (child_jurisdiction_id <> parent_jurisdiction_id),
  UNIQUE (tenant_id, child_jurisdiction_id, version_no),
  FOREIGN KEY (tenant_id, child_jurisdiction_id)
    REFERENCES sf_jurisdiction.jurisdiction (tenant_id, jurisdiction_id),
  FOREIGN KEY (tenant_id, parent_jurisdiction_id)
    REFERENCES sf_jurisdiction.jurisdiction (tenant_id, jurisdiction_id)
);
CREATE INDEX jurisdiction_relation_child_idx
  ON sf_jurisdiction.jurisdiction_relation (tenant_id, child_jurisdiction_id, valid_from DESC);
CREATE INDEX jurisdiction_relation_parent_idx
  ON sf_jurisdiction.jurisdiction_relation (tenant_id, parent_jurisdiction_id, valid_from);
ALTER TABLE sf_jurisdiction.jurisdiction_relation ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_jurisdiction.jurisdiction_relation FORCE ROW LEVEL SECURITY;
CREATE POLICY jurisdiction_relation_isolation ON sf_jurisdiction.jurisdiction_relation TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_jurisdiction.jurisdiction_relation OWNER TO sf_migrator;

-- sf:isolation sf_jurisdiction.jurisdiction_binding TENANT_SCOPED owner=CMP-003
-- Opaque target refs only — no FK to organisation/office/service (no cross-component SQL).
CREATE TABLE sf_jurisdiction.jurisdiction_binding (
  binding_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  jurisdiction_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  target_ref text NOT NULL CHECK (char_length(target_ref) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  valid_from timestamptz NOT NULL,
  version_no bigint NOT NULL CHECK (version_no >= 1),
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 1000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, target_type, target_ref, version_no),
  FOREIGN KEY (tenant_id, jurisdiction_id)
    REFERENCES sf_jurisdiction.jurisdiction (tenant_id, jurisdiction_id)
);
CREATE INDEX jurisdiction_binding_lookup_idx
  ON sf_jurisdiction.jurisdiction_binding (tenant_id, target_type, target_ref, valid_from DESC);
ALTER TABLE sf_jurisdiction.jurisdiction_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_jurisdiction.jurisdiction_binding FORCE ROW LEVEL SECURITY;
CREATE POLICY jurisdiction_binding_isolation ON sf_jurisdiction.jurisdiction_binding TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_jurisdiction.jurisdiction_binding OWNER TO sf_migrator;

-- sf:isolation sf_jurisdiction.idempotency_record TENANT_SCOPED owner=CMP-003
CREATE TABLE sf_jurisdiction.idempotency_record (
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
ALTER TABLE sf_jurisdiction.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_jurisdiction.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_jurisdiction.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_jurisdiction.idempotency_record OWNER TO sf_migrator;

REVOKE ALL ON ALL TABLES IN SCHEMA sf_jurisdiction FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_jurisdiction FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_jurisdiction FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE (display_label, status) ON sf_jurisdiction.jurisdiction_type TO sf_cmp003_rw;
GRANT SELECT, INSERT ON sf_jurisdiction.jurisdiction TO sf_cmp003_rw;
GRANT SELECT, INSERT ON sf_jurisdiction.jurisdiction_version TO sf_cmp003_rw;
GRANT SELECT, INSERT ON sf_jurisdiction.jurisdiction_relation TO sf_cmp003_rw;
GRANT SELECT, INSERT ON sf_jurisdiction.jurisdiction_binding TO sf_cmp003_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_jurisdiction.idempotency_record TO sf_cmp003_rw;

ALTER TABLE sf_jurisdiction.jurisdiction_type ALTER COLUMN display_label SET STATISTICS 0;
ALTER TABLE sf_jurisdiction.jurisdiction ALTER COLUMN code SET STATISTICS 0;
ALTER TABLE sf_jurisdiction.jurisdiction_version ALTER COLUMN name SET STATISTICS 0;
ALTER TABLE sf_jurisdiction.jurisdiction_binding ALTER COLUMN target_ref SET STATISTICS 0;
ALTER TABLE sf_jurisdiction.jurisdiction_binding ALTER COLUMN reason SET STATISTICS 0;

-- Down Migration
REVOKE ALL ON SCHEMA sf_jurisdiction FROM sf_cmp003_rw;
DROP SCHEMA IF EXISTS sf_jurisdiction CASCADE;
DROP ROLE IF EXISTS sf_cmp003_rw;
