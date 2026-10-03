-- ServiceForm AI CMP-002 Tenant & Government Organisation schema (ADR-0006 Option A).
-- Schema sf_tenant_org owned by sf_migrator. DML via sf_cmp002_rw. RLS policies TO sf_app.

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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp002_rw') THEN
    CREATE ROLE sf_cmp002_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp002_rw IS 'CMP-002 privilege role (ADR-0006). NOLOGIN. Holds DML on sf_tenant_org business tables.';

CREATE SCHEMA sf_tenant_org AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_tenant_org IS 'isolation_class=mixed; owner=CMP-002; Tenant and government organisation';

REVOKE ALL ON SCHEMA sf_tenant_org FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_tenant_org TO sf_cmp002_rw;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_tenant_org REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_tenant_org REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_tenant_org REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- sf:isolation sf_tenant_org.tenant TENANT_SCOPED owner=CMP-002
CREATE TABLE sf_tenant_org.tenant (
  tenant_id uuid NOT NULL PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sf_tenant_org.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_tenant_org.tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sf_tenant_org.tenant TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_tenant_org.tenant OWNER TO sf_migrator;

-- sf:isolation sf_tenant_org.tenant_cell_binding TENANT_SCOPED owner=CMP-002
CREATE TABLE sf_tenant_org.tenant_cell_binding (
  binding_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES sf_tenant_org.tenant (tenant_id),
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  isolation_model text NOT NULL CHECK (isolation_model IN ('POOL', 'BRIDGE', 'SILO')),
  valid_from timestamptz NOT NULL,
  seq bigint NOT NULL CHECK (seq >= 1),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  requested_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, seq),
  UNIQUE (tenant_id, valid_from)
);
CREATE INDEX tenant_cell_binding_current_idx ON sf_tenant_org.tenant_cell_binding (tenant_id, valid_from DESC);
ALTER TABLE sf_tenant_org.tenant_cell_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_tenant_org.tenant_cell_binding FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_cell_binding_isolation ON sf_tenant_org.tenant_cell_binding TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_tenant_org.tenant_cell_binding OWNER TO sf_migrator;

-- sf:isolation sf_tenant_org.tenant_placement_proposal TENANT_SCOPED owner=CMP-002
CREATE TABLE sf_tenant_org.tenant_placement_proposal (
  proposal_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES sf_tenant_org.tenant (tenant_id),
  proposed_cell_id text NOT NULL CHECK (proposed_cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  proposed_isolation_model text NOT NULL CHECK (proposed_isolation_model IN ('POOL', 'BRIDGE', 'SILO')),
  status text NOT NULL CHECK (status IN ('PROPOSED', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  requested_by uuid NOT NULL,
  approved_by uuid,
  valid_from timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  CHECK (
    (status = 'PROPOSED' AND approved_by IS NULL AND approved_at IS NULL)
    OR (status IN ('APPROVED', 'REJECTED', 'SUPERSEDED'))
  )
);
CREATE UNIQUE INDEX tenant_placement_proposal_open_idx
  ON sf_tenant_org.tenant_placement_proposal (tenant_id)
  WHERE status = 'PROPOSED';
ALTER TABLE sf_tenant_org.tenant_placement_proposal ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_tenant_org.tenant_placement_proposal FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_placement_proposal_isolation ON sf_tenant_org.tenant_placement_proposal TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_tenant_org.tenant_placement_proposal OWNER TO sf_migrator;

-- sf:isolation sf_tenant_org.organisation TENANT_SCOPED owner=CMP-002
CREATE TABLE sf_tenant_org.organisation (
  tenant_id uuid NOT NULL REFERENCES sf_tenant_org.tenant (tenant_id),
  organisation_id uuid NOT NULL,
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  PRIMARY KEY (tenant_id, organisation_id),
  UNIQUE (tenant_id, code)
);
ALTER TABLE sf_tenant_org.organisation ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_tenant_org.organisation FORCE ROW LEVEL SECURITY;
CREATE POLICY organisation_isolation ON sf_tenant_org.organisation TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_tenant_org.organisation OWNER TO sf_migrator;

-- sf:isolation sf_tenant_org.organisation_version TENANT_SCOPED owner=CMP-002
CREATE TABLE sf_tenant_org.organisation_version (
  tenant_id uuid NOT NULL,
  organisation_id uuid NOT NULL,
  version_no bigint NOT NULL CHECK (version_no >= 1),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  organisation_type_code text NOT NULL CHECK (organisation_type_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DISSOLVED')),
  valid_from timestamptz NOT NULL,
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 1000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, organisation_id, version_no),
  UNIQUE (tenant_id, organisation_id, valid_from),
  FOREIGN KEY (tenant_id, organisation_id) REFERENCES sf_tenant_org.organisation (tenant_id, organisation_id)
);
CREATE INDEX organisation_version_as_of_idx ON sf_tenant_org.organisation_version (tenant_id, organisation_id, valid_from DESC);
ALTER TABLE sf_tenant_org.organisation_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_tenant_org.organisation_version FORCE ROW LEVEL SECURITY;
CREATE POLICY organisation_version_isolation ON sf_tenant_org.organisation_version TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_tenant_org.organisation_version OWNER TO sf_migrator;

-- sf:isolation sf_tenant_org.organisation_relation TENANT_SCOPED owner=CMP-002
CREATE TABLE sf_tenant_org.organisation_relation (
  relation_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  child_organisation_id uuid NOT NULL,
  parent_organisation_id uuid,
  relation_type_code text NOT NULL CHECK (relation_type_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  version_no bigint NOT NULL CHECK (version_no >= 1),
  valid_from timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (child_organisation_id <> parent_organisation_id),
  UNIQUE (tenant_id, child_organisation_id, version_no),
  FOREIGN KEY (tenant_id, child_organisation_id) REFERENCES sf_tenant_org.organisation (tenant_id, organisation_id),
  FOREIGN KEY (tenant_id, parent_organisation_id) REFERENCES sf_tenant_org.organisation (tenant_id, organisation_id)
);
CREATE INDEX organisation_relation_child_idx
  ON sf_tenant_org.organisation_relation (tenant_id, child_organisation_id, valid_from DESC);
CREATE INDEX organisation_relation_parent_idx
  ON sf_tenant_org.organisation_relation (tenant_id, parent_organisation_id, valid_from);
ALTER TABLE sf_tenant_org.organisation_relation ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_tenant_org.organisation_relation FORCE ROW LEVEL SECURITY;
CREATE POLICY organisation_relation_isolation ON sf_tenant_org.organisation_relation TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_tenant_org.organisation_relation OWNER TO sf_migrator;

-- sf:isolation sf_tenant_org.office TENANT_SCOPED owner=CMP-002
CREATE TABLE sf_tenant_org.office (
  tenant_id uuid NOT NULL,
  office_id uuid NOT NULL,
  organisation_id uuid NOT NULL,
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 64),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE')),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  PRIMARY KEY (tenant_id, office_id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, organisation_id) REFERENCES sf_tenant_org.organisation (tenant_id, organisation_id)
);
CREATE INDEX office_org_idx ON sf_tenant_org.office (tenant_id, organisation_id);
ALTER TABLE sf_tenant_org.office ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_tenant_org.office FORCE ROW LEVEL SECURITY;
CREATE POLICY office_isolation ON sf_tenant_org.office TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_tenant_org.office OWNER TO sf_migrator;

-- sf:isolation sf_tenant_org.idempotency_record TENANT_SCOPED owner=CMP-002
CREATE TABLE sf_tenant_org.idempotency_record (
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
ALTER TABLE sf_tenant_org.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_tenant_org.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_tenant_org.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_tenant_org.idempotency_record OWNER TO sf_migrator;

-- sf:isolation sf_tenant_org.idempotency_record_platform PLATFORM_OPERATIONAL owner=CMP-002
CREATE TABLE sf_tenant_org.idempotency_record_platform (
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
ALTER TABLE sf_tenant_org.idempotency_record_platform ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_tenant_org.idempotency_record_platform FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_platform_actor ON sf_tenant_org.idempotency_record_platform TO sf_app
  USING (principal_id = sf_platform.current_actor_id())
  WITH CHECK (principal_id = sf_platform.current_actor_id());
ALTER TABLE sf_tenant_org.idempotency_record_platform OWNER TO sf_migrator;

CREATE FUNCTION sf_tenant_org.enforce_tenant_status_marker()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_tenant_org, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF current_setting('app.privileged_marker', true) IS DISTINCT FROM 'TENANT_STATUS' THEN
      RAISE EXCEPTION 'tenant status change requires privileged marker'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_status_privileged
  BEFORE UPDATE ON sf_tenant_org.tenant
  FOR EACH ROW
  EXECUTE FUNCTION sf_tenant_org.enforce_tenant_status_marker();
ALTER FUNCTION sf_tenant_org.enforce_tenant_status_marker() OWNER TO sf_migrator;

CREATE FUNCTION sf_tenant_org.enforce_placement_proposal_machine()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_tenant_org, pg_temp
AS $$
DECLARE
  actor uuid;
BEGIN
  actor := sf_platform.current_actor_id();
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'PROPOSED' THEN
      RAISE EXCEPTION 'placement proposal insert must be PROPOSED'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.requested_by IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'placement proposal requested_by must equal current actor'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM 'PROPOSED' THEN
      RAISE EXCEPTION 'terminal placement proposal cannot be mutated'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.status NOT IN ('APPROVED', 'REJECTED', 'SUPERSEDED') THEN
      RAISE EXCEPTION 'placement proposal may only leave PROPOSED for a terminal status'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.proposal_id IS DISTINCT FROM OLD.proposal_id
       OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
       OR NEW.proposed_cell_id IS DISTINCT FROM OLD.proposed_cell_id
       OR NEW.proposed_isolation_model IS DISTINCT FROM OLD.proposed_isolation_model THEN
      RAISE EXCEPTION 'placement proposal identity fields are immutable'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'APPROVED' THEN
      IF actor IS NULL OR actor = OLD.requested_by THEN
        RAISE EXCEPTION 'placement proposal must be approved by a different actor'
          USING ERRCODE = '42501';
      END IF;
      IF NEW.approved_by IS DISTINCT FROM actor THEN
        RAISE EXCEPTION 'placement proposal approved_by must equal current actor'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'placement proposal delete is not permitted' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER tenant_placement_proposal_machine
  BEFORE INSERT OR UPDATE OR DELETE ON sf_tenant_org.tenant_placement_proposal
  FOR EACH ROW
  EXECUTE FUNCTION sf_tenant_org.enforce_placement_proposal_machine();
ALTER FUNCTION sf_tenant_org.enforce_placement_proposal_machine() OWNER TO sf_migrator;

REVOKE ALL ON ALL TABLES IN SCHEMA sf_tenant_org FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_tenant_org FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_tenant_org FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE (status, display_name, version, updated_at) ON sf_tenant_org.tenant TO sf_cmp002_rw;
GRANT SELECT, INSERT ON sf_tenant_org.tenant_cell_binding TO sf_cmp002_rw;
GRANT SELECT, INSERT, UPDATE (status, approved_by, approved_at) ON sf_tenant_org.tenant_placement_proposal TO sf_cmp002_rw;
GRANT SELECT, INSERT ON sf_tenant_org.organisation TO sf_cmp002_rw;
GRANT SELECT, INSERT ON sf_tenant_org.organisation_version TO sf_cmp002_rw;
GRANT SELECT, INSERT ON sf_tenant_org.organisation_relation TO sf_cmp002_rw;
GRANT SELECT, INSERT, UPDATE (status, version, activated_at, name) ON sf_tenant_org.office TO sf_cmp002_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body) ON sf_tenant_org.idempotency_record TO sf_cmp002_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body) ON sf_tenant_org.idempotency_record_platform TO sf_cmp002_rw;
GRANT EXECUTE ON FUNCTION sf_tenant_org.enforce_tenant_status_marker() TO sf_cmp002_rw;
GRANT EXECUTE ON FUNCTION sf_tenant_org.enforce_placement_proposal_machine() TO sf_cmp002_rw;

ALTER TABLE sf_tenant_org.tenant ALTER COLUMN display_name SET STATISTICS 0;
ALTER TABLE sf_tenant_org.organisation ALTER COLUMN code SET STATISTICS 0;
ALTER TABLE sf_tenant_org.organisation_version ALTER COLUMN name SET STATISTICS 0;
ALTER TABLE sf_tenant_org.office ALTER COLUMN name SET STATISTICS 0;
ALTER TABLE sf_tenant_org.office ALTER COLUMN code SET STATISTICS 0;
ALTER TABLE sf_tenant_org.tenant_cell_binding ALTER COLUMN reason SET STATISTICS 0;
ALTER TABLE sf_tenant_org.tenant_placement_proposal ALTER COLUMN reason SET STATISTICS 0;

-- Down Migration
REVOKE ALL ON SCHEMA sf_tenant_org FROM sf_cmp002_rw;
DROP SCHEMA IF EXISTS sf_tenant_org CASCADE;
DROP ROLE IF EXISTS sf_cmp002_rw;
