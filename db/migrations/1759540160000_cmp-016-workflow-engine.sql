-- CMP-016 Workflow Engine (SF-M05-002). ADR-0006 Option A: sf_cmp016_rw NOLOGIN holds DML;
-- FORCE RLS; PUBLIC revoked; runtime is not table owner (sf_migrator).
-- Stores the canonical ServiceForm Workflow Model (SF-CON-WORKFLOW-MODEL) definitions and
-- versions, the Temporal sequencing binding per application, approved migration plans and
-- withdrawal/cancellation request records (ADR-0003). Authoritative case state is NOT stored
-- here: it belongs to CMP-015 and is never read or written by this schema (Constitution #10).
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp016_rw') THEN
    CREATE ROLE sf_cmp016_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp016_rw IS
  'ADR-0006: CMP-016 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_workflow AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_workflow IS
  'isolation_class=mixed; owner=CMP-016; canonical workflow model versions and Temporal sequencing bindings (never case state)';

REVOKE ALL ON SCHEMA sf_workflow FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_workflow TO sf_cmp016_rw;
GRANT USAGE ON SCHEMA sf_workflow TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_workflow REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_workflow REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_workflow REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_workflow.workflow_definition TENANT_SCOPED owner=CMP-016
CREATE TABLE sf_workflow.workflow_definition (
  definition_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  definition_key text NOT NULL CHECK (definition_key ~ '^[a-z][a-z0-9._-]{1,127}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, definition_id),
  UNIQUE (tenant_id, definition_key)
);
ALTER TABLE sf_workflow.workflow_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_workflow.workflow_definition FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_definition_tenant ON sf_workflow.workflow_definition TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_workflow.workflow_definition OWNER TO sf_migrator;

-- sf:isolation sf_workflow.workflow_version TENANT_SCOPED owner=CMP-016
-- A PUBLISHED or RETIRED version is immutable (Constitution #8); only PUBLISHED -> RETIRED is legal.
CREATE TABLE sf_workflow.workflow_version (
  version_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  definition_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no >= 1),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  origin text NOT NULL CHECK (origin IN ('STUDIO', 'BPMN_IMPORT')),
  model jsonb NOT NULL CHECK (jsonb_typeof(model) = 'object' AND octet_length(model::text) <= 524288),
  graph_hash text NOT NULL CHECK (graph_hash ~ '^sha256:[0-9a-f]{64}$'),
  authored_by uuid NOT NULL,
  published_by uuid,
  publication_approval_ref text CHECK (publication_approval_ref ~ '^[A-Za-z0-9_.:-]{1,200}$'),
  published_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version_id),
  UNIQUE (tenant_id, definition_id, version_no),
  FOREIGN KEY (tenant_id, definition_id)
    REFERENCES sf_workflow.workflow_definition (tenant_id, definition_id),
  CHECK (
    status = 'DRAFT'
    OR (published_by IS NOT NULL AND publication_approval_ref IS NOT NULL AND published_at IS NOT NULL)
  ),
  CHECK (published_by IS NULL OR published_by <> authored_by),
  CHECK ((status = 'RETIRED') = (retired_at IS NOT NULL))
);
CREATE INDEX workflow_version_definition_idx
  ON sf_workflow.workflow_version (tenant_id, definition_id, version_no DESC);
ALTER TABLE sf_workflow.workflow_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_workflow.workflow_version FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_version_tenant ON sf_workflow.workflow_version TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_workflow.workflow_version OWNER TO sf_migrator;

CREATE FUNCTION sf_workflow.guard_version_immutability() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'published workflow versions are immutable'
        USING ERRCODE = 'P0001', HINT = 'SF_PUBLISHED_IMMUTABLE';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.version_id IS DISTINCT FROM OLD.version_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.definition_id IS DISTINCT FROM OLD.definition_id
     OR NEW.version_no IS DISTINCT FROM OLD.version_no
     OR NEW.origin IS DISTINCT FROM OLD.origin
     OR NEW.authored_by IS DISTINCT FROM OLD.authored_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'workflow version identity is immutable'
      USING ERRCODE = 'P0001', HINT = 'SF_PUBLISHED_IMMUTABLE';
  END IF;
  IF OLD.status = 'DRAFT' THEN
    IF NEW.status = 'RETIRED' THEN
      RAISE EXCEPTION 'a draft cannot be retired'
        USING ERRCODE = 'P0001', HINT = 'SF_VERSION_TRANSITION';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.model IS DISTINCT FROM OLD.model
     OR NEW.graph_hash IS DISTINCT FROM OLD.graph_hash
     OR NEW.published_by IS DISTINCT FROM OLD.published_by
     OR NEW.publication_approval_ref IS DISTINCT FROM OLD.publication_approval_ref
     OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'published workflow versions are immutable'
      USING ERRCODE = 'P0001', HINT = 'SF_PUBLISHED_IMMUTABLE';
  END IF;
  IF NOT (OLD.status = 'PUBLISHED' AND NEW.status = 'RETIRED') THEN
    RAISE EXCEPTION 'illegal workflow version status change'
      USING ERRCODE = 'P0001', HINT = 'SF_VERSION_TRANSITION';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_workflow.guard_version_immutability() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_workflow.guard_version_immutability() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_workflow.guard_version_immutability() TO sf_app, sf_cmp016_rw;

CREATE TRIGGER workflow_version_immutable
  BEFORE UPDATE OR DELETE ON sf_workflow.workflow_version
  FOR EACH ROW
  EXECUTE FUNCTION sf_workflow.guard_version_immutability();

-- sf:isolation sf_workflow.migration_plan TENANT_SCOPED owner=CMP-016
-- Constitution #35: explicit, simulated, maker-checker approved, evidence-backed. Append-only.
CREATE TABLE sf_workflow.migration_plan (
  migration_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  from_version_id uuid NOT NULL,
  to_version_id uuid NOT NULL,
  node_mapping jsonb NOT NULL CHECK (jsonb_typeof(node_mapping) = 'object'),
  approval_ref text NOT NULL CHECK (approval_ref ~ '^[A-Za-z0-9_.:-]{1,200}$'),
  simulation_evidence_ref text NOT NULL CHECK (simulation_evidence_ref ~ '^[A-Za-z0-9_.:/-]{1,200}$'),
  requested_by uuid NOT NULL,
  approved_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, migration_id),
  CHECK (from_version_id <> to_version_id),
  CHECK (requested_by <> approved_by),
  FOREIGN KEY (tenant_id, from_version_id) REFERENCES sf_workflow.workflow_version (tenant_id, version_id),
  FOREIGN KEY (tenant_id, to_version_id) REFERENCES sf_workflow.workflow_version (tenant_id, version_id)
);
ALTER TABLE sf_workflow.migration_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_workflow.migration_plan FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_plan_tenant ON sf_workflow.migration_plan TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_workflow.migration_plan OWNER TO sf_migrator;

CREATE FUNCTION sf_workflow.guard_migration_plan() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
DECLARE
  from_def uuid;
  to_def uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'migration plans are immutable'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  SELECT definition_id INTO from_def FROM sf_workflow.workflow_version
    WHERE tenant_id = NEW.tenant_id AND version_id = NEW.from_version_id AND status IN ('PUBLISHED', 'RETIRED');
  SELECT definition_id INTO to_def FROM sf_workflow.workflow_version
    WHERE tenant_id = NEW.tenant_id AND version_id = NEW.to_version_id AND status = 'PUBLISHED';
  IF from_def IS NULL OR to_def IS NULL OR from_def <> to_def THEN
    RAISE EXCEPTION 'migration requires published versions of one definition'
      USING ERRCODE = 'P0001', HINT = 'SF_MIGRATION_INVALID';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_workflow.guard_migration_plan() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_workflow.guard_migration_plan() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_workflow.guard_migration_plan() TO sf_app, sf_cmp016_rw;

CREATE TRIGGER migration_plan_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_workflow.migration_plan
  FOR EACH ROW
  EXECUTE FUNCTION sf_workflow.guard_migration_plan();

-- sf:isolation sf_workflow.workflow_instance TENANT_SCOPED owner=CMP-016
-- Temporal sequencing binding for one application. active_nodes is a sequencing projection,
-- not case state. The pinned version changes only through an approved migration_plan.
CREATE TABLE sf_workflow.workflow_instance (
  instance_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  application_id uuid NOT NULL,
  workflow_version_id uuid NOT NULL,
  graph_hash text NOT NULL CHECK (graph_hash ~ '^sha256:[0-9a-f]{64}$'),
  temporal_workflow_id text NOT NULL CHECK (temporal_workflow_id ~ '^sf-wf:[0-9a-f-]{36}:[0-9a-f-]{36}$'),
  status text NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'TERMINATED', 'FAULTED')),
  active_nodes jsonb NOT NULL CHECK (jsonb_typeof(active_nodes) = 'array'),
  last_signal_id uuid,
  migration_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, instance_id),
  UNIQUE (tenant_id, application_id),
  UNIQUE (temporal_workflow_id),
  FOREIGN KEY (tenant_id, workflow_version_id) REFERENCES sf_workflow.workflow_version (tenant_id, version_id),
  FOREIGN KEY (tenant_id, migration_id) REFERENCES sf_workflow.migration_plan (tenant_id, migration_id)
);
ALTER TABLE sf_workflow.workflow_instance ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_workflow.workflow_instance FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_instance_tenant ON sf_workflow.workflow_instance TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_workflow.workflow_instance OWNER TO sf_migrator;

CREATE FUNCTION sf_workflow.guard_instance_pin() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
DECLARE
  pinned_hash text;
  plan_ok boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'workflow instances are retained'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  SELECT graph_hash INTO pinned_hash FROM sf_workflow.workflow_version
    WHERE tenant_id = NEW.tenant_id AND version_id = NEW.workflow_version_id AND status = 'PUBLISHED';
  IF TG_OP = 'INSERT' THEN
    IF pinned_hash IS NULL OR pinned_hash <> NEW.graph_hash THEN
      RAISE EXCEPTION 'workflow instances run only published canonical versions'
        USING ERRCODE = 'P0001', HINT = 'SF_VERSION_NOT_PUBLISHED';
    END IF;
    IF NEW.migration_id IS NOT NULL THEN
      RAISE EXCEPTION 'a new instance cannot carry a migration'
        USING ERRCODE = 'P0001', HINT = 'SF_SILENT_REPOINT';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.instance_id IS DISTINCT FROM OLD.instance_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.cell_id IS DISTINCT FROM OLD.cell_id
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.temporal_workflow_id IS DISTINCT FROM OLD.temporal_workflow_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'workflow instance identity is immutable'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  IF OLD.status <> 'RUNNING' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'terminal workflow instance cannot change status'
      USING ERRCODE = 'P0001', HINT = 'SF_INSTANCE_TERMINAL';
  END IF;
  IF NEW.workflow_version_id IS DISTINCT FROM OLD.workflow_version_id
     OR NEW.graph_hash IS DISTINCT FROM OLD.graph_hash
     OR NEW.migration_id IS DISTINCT FROM OLD.migration_id THEN
    SELECT EXISTS (
      SELECT 1 FROM sf_workflow.migration_plan p
       WHERE p.tenant_id = NEW.tenant_id
         AND p.migration_id = NEW.migration_id
         AND p.from_version_id = OLD.workflow_version_id
         AND p.to_version_id = NEW.workflow_version_id
    ) INTO plan_ok;
    IF NOT plan_ok OR NEW.migration_id IS NOT DISTINCT FROM OLD.migration_id
       OR pinned_hash IS NULL OR pinned_hash <> NEW.graph_hash OR OLD.status <> 'RUNNING' THEN
      RAISE EXCEPTION 'pinned workflow version changes only through an approved migration'
        USING ERRCODE = 'P0001', HINT = 'SF_SILENT_REPOINT';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_workflow.guard_instance_pin() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_workflow.guard_instance_pin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_workflow.guard_instance_pin() TO sf_app, sf_cmp016_rw;

CREATE TRIGGER workflow_instance_pin_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_workflow.workflow_instance
  FOR EACH ROW
  EXECUTE FUNCTION sf_workflow.guard_instance_pin();

-- sf:isolation sf_workflow.workflow_request TENANT_SCOPED owner=CMP-016
-- ADR-0003: withdrawal/cancellation requests are workflow records, never CMP-015 states.
CREATE TABLE sf_workflow.workflow_request (
  request_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  application_id uuid NOT NULL,
  request_kind text NOT NULL CHECK (request_kind IN ('WITHDRAWAL', 'CANCELLATION')),
  request_node_id text NOT NULL CHECK (request_node_id ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  outcome text NOT NULL CHECK (outcome ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  status text NOT NULL CHECK (status IN ('PENDING_REVIEW', 'REJECTED', 'EXPIRED', 'RESOLVED')),
  requested_by uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, request_id),
  UNIQUE (tenant_id, application_id, idempotency_key),
  FOREIGN KEY (tenant_id, instance_id) REFERENCES sf_workflow.workflow_instance (tenant_id, instance_id)
);
CREATE UNIQUE INDEX workflow_request_one_pending_idx
  ON sf_workflow.workflow_request (tenant_id, application_id, request_kind)
  WHERE status = 'PENDING_REVIEW';
ALTER TABLE sf_workflow.workflow_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_workflow.workflow_request FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_request_tenant ON sf_workflow.workflow_request TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_workflow.workflow_request OWNER TO sf_migrator;

CREATE FUNCTION sf_workflow.guard_request_status() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.instance_id IS DISTINCT FROM OLD.instance_id
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.request_kind IS DISTINCT FROM OLD.request_kind
     OR NEW.request_node_id IS DISTINCT FROM OLD.request_node_id
     OR NEW.outcome IS DISTINCT FROM OLD.outcome
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'workflow request identity is immutable'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  IF OLD.status <> 'PENDING_REVIEW' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'resolved workflow request cannot change status'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_workflow.guard_request_status() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_workflow.guard_request_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_workflow.guard_request_status() TO sf_app, sf_cmp016_rw;

CREATE TRIGGER workflow_request_status_guard
  BEFORE UPDATE OR DELETE ON sf_workflow.workflow_request
  FOR EACH ROW
  EXECUTE FUNCTION sf_workflow.guard_request_status();

-- sf:isolation sf_workflow.idempotency_record TENANT_SCOPED owner=CMP-016
CREATE TABLE sf_workflow.idempotency_record (
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
ALTER TABLE sf_workflow.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_workflow.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_tenant ON sf_workflow.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_workflow.idempotency_record OWNER TO sf_migrator;

GRANT SELECT, INSERT ON sf_workflow.workflow_definition TO sf_cmp016_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (
  status, model, graph_hash, published_by, publication_approval_ref, published_at, retired_at
) ON sf_workflow.workflow_version TO sf_cmp016_rw;
GRANT SELECT, INSERT ON sf_workflow.migration_plan TO sf_cmp016_rw;
GRANT SELECT, INSERT, UPDATE (
  workflow_version_id, graph_hash, status, active_nodes, last_signal_id, migration_id, updated_at
) ON sf_workflow.workflow_instance TO sf_cmp016_rw;
GRANT SELECT, INSERT, UPDATE (status, updated_at) ON sf_workflow.workflow_request TO sf_cmp016_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (
  status, response_ref, response_status, response_body
) ON sf_workflow.idempotency_record TO sf_cmp016_rw;

REVOKE ALL ON sf_workflow.workflow_definition FROM PUBLIC;
REVOKE ALL ON sf_workflow.workflow_version FROM PUBLIC;
REVOKE ALL ON sf_workflow.migration_plan FROM PUBLIC;
REVOKE ALL ON sf_workflow.workflow_instance FROM PUBLIC;
REVOKE ALL ON sf_workflow.workflow_request FROM PUBLIC;
REVOKE ALL ON sf_workflow.idempotency_record FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS workflow_request_status_guard ON sf_workflow.workflow_request;
DROP TRIGGER IF EXISTS workflow_instance_pin_guard ON sf_workflow.workflow_instance;
DROP TRIGGER IF EXISTS migration_plan_guard ON sf_workflow.migration_plan;
DROP TRIGGER IF EXISTS workflow_version_immutable ON sf_workflow.workflow_version;
DROP FUNCTION IF EXISTS sf_workflow.guard_request_status();
DROP FUNCTION IF EXISTS sf_workflow.guard_instance_pin();
DROP FUNCTION IF EXISTS sf_workflow.guard_migration_plan();
DROP FUNCTION IF EXISTS sf_workflow.guard_version_immutability();
DROP TABLE IF EXISTS sf_workflow.idempotency_record;
DROP TABLE IF EXISTS sf_workflow.workflow_request;
DROP TABLE IF EXISTS sf_workflow.workflow_instance;
DROP TABLE IF EXISTS sf_workflow.migration_plan;
DROP TABLE IF EXISTS sf_workflow.workflow_version;
DROP TABLE IF EXISTS sf_workflow.workflow_definition;
DROP SCHEMA IF EXISTS sf_workflow;
-- Role sf_cmp016_rw retained (may be referenced by runtime logins); never DROP ROLE here.
