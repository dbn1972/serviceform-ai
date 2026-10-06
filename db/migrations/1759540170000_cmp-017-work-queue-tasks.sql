-- CMP-017 Work Queue / Human Task (SF-M05-003). ADR-0006 Option A: sf_cmp017_rw NOLOGIN holds
-- DML; FORCE RLS on every tenant-scoped table; PUBLIC revoked; runtime is not table owner
-- (sf_migrator). Assignment is criteria only: role + organisation/office + jurisdiction + service
-- scope (Constitution #19). No column can name an officer in published assignment metadata;
-- claimed_principal_id is a RUNTIME claim record only and is cleared on unclaim/reassign.
-- Terminal tasks (COMPLETED, CANCELLED_CLOSED) are immutable at the database layer.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp017_rw') THEN
    CREATE ROLE sf_cmp017_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp017_rw IS
  'ADR-0006: CMP-017 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_tasks AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_tasks IS
  'isolation_class=TENANT_SCOPED; owner=CMP-017; human task lifecycle, claim and assignment history';

REVOKE ALL ON SCHEMA sf_tasks FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_tasks TO sf_cmp017_rw;
GRANT USAGE ON SCHEMA sf_tasks TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_tasks REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_tasks REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_tasks REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_tasks.human_task TENANT_SCOPED owner=CMP-017
CREATE TABLE sf_tasks.human_task (
  tenant_id uuid NOT NULL,
  task_id uuid NOT NULL,
  application_id uuid NOT NULL,
  workflow_node_id text CHECK (workflow_node_id IS NULL OR workflow_node_id ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  task_state text NOT NULL CHECK (task_state IN ('OPEN', 'CLAIMED', 'COMPLETED', 'CANCELLED_CLOSED')),
  role_code text NOT NULL CHECK (role_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  organisation_id uuid NOT NULL,
  office_id uuid,
  jurisdiction_id uuid NOT NULL,
  service_scope_id uuid,
  claimed_principal_id uuid,
  claimed_at timestamptz,
  outcome text CHECK (outcome IS NULL OR outcome ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  created_by uuid NOT NULL,
  correlation_id uuid NOT NULL,
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, task_id),
  CHECK (task_state <> 'OPEN' OR (claimed_principal_id IS NULL AND claimed_at IS NULL)),
  CHECK (task_state <> 'CLAIMED' OR (claimed_principal_id IS NOT NULL AND claimed_at IS NOT NULL)),
  CHECK (task_state <> 'COMPLETED' OR (claimed_principal_id IS NOT NULL AND outcome IS NOT NULL)),
  CHECK (task_state <> 'CANCELLED_CLOSED' OR outcome IS NOT NULL)
);
CREATE UNIQUE INDEX human_task_active_node_uidx
  ON sf_tasks.human_task (tenant_id, application_id, workflow_node_id)
  WHERE task_state IN ('OPEN', 'CLAIMED') AND workflow_node_id IS NOT NULL;
CREATE INDEX human_task_application_idx ON sf_tasks.human_task (tenant_id, application_id);
CREATE INDEX human_task_available_idx
  ON sf_tasks.human_task (tenant_id, role_code, organisation_id, jurisdiction_id)
  WHERE task_state = 'OPEN';
ALTER TABLE sf_tasks.human_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_tasks.human_task FORCE ROW LEVEL SECURITY;
CREATE POLICY human_task_isolation ON sf_tasks.human_task TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_tasks.human_task OWNER TO sf_migrator;

-- sf:isolation sf_tasks.task_history TENANT_SCOPED owner=CMP-017
CREATE TABLE sf_tasks.task_history (
  tenant_id uuid NOT NULL,
  history_id uuid NOT NULL,
  task_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq >= 1),
  operation text NOT NULL CHECK (operation IN (
    'CREATE', 'CLAIM', 'UNCLAIM', 'REASSIGN', 'COMPLETE', 'CANCEL_CLOSE'
  )),
  from_state text CHECK (from_state IS NULL OR from_state IN ('OPEN', 'CLAIMED', 'COMPLETED', 'CANCELLED_CLOSED')),
  to_state text NOT NULL CHECK (to_state IN ('OPEN', 'CLAIMED', 'COMPLETED', 'CANCELLED_CLOSED')),
  actor_type text NOT NULL CHECK (actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  actor_id uuid NOT NULL,
  role_code text NOT NULL CHECK (role_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  organisation_id uuid NOT NULL,
  office_id uuid,
  jurisdiction_id uuid NOT NULL,
  service_scope_id uuid,
  claimed_principal_id uuid,
  outcome text CHECK (outcome IS NULL OR outcome ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  authz_decision_id uuid NOT NULL,
  policy_revision text NOT NULL CHECK (char_length(policy_revision) BETWEEN 1 AND 128),
  target_authz_decision_id uuid,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, history_id),
  UNIQUE (tenant_id, task_id, seq),
  FOREIGN KEY (tenant_id, task_id) REFERENCES sf_tasks.human_task (tenant_id, task_id)
);
ALTER TABLE sf_tasks.task_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_tasks.task_history FORCE ROW LEVEL SECURITY;
CREATE POLICY task_history_isolation ON sf_tasks.task_history TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_tasks.task_history OWNER TO sf_migrator;

-- sf:isolation sf_tasks.idempotency_record TENANT_SCOPED owner=CMP-017
CREATE TABLE sf_tasks.idempotency_record (
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
ALTER TABLE sf_tasks.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_tasks.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_tasks.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_tasks.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_tasks.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_tasks, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'insert-only task history row'
    USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_tasks.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER task_history_immutable
  BEFORE UPDATE OR DELETE ON sf_tasks.task_history
  FOR EACH ROW
  EXECUTE FUNCTION sf_tasks.reject_mutation();

CREATE FUNCTION sf_tasks.guard_task_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_tasks, pg_temp
AS $$
DECLARE
  assignment_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'human tasks are retained' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.task_state <> 'OPEN' OR NEW.claimed_principal_id IS NOT NULL THEN
      RAISE EXCEPTION 'human task must start OPEN and unclaimed';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.task_state IN ('COMPLETED', 'CANCELLED_CLOSED') THEN
    RAISE EXCEPTION 'terminal human task % is immutable', OLD.task_state USING ERRCODE = 'P0001';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.workflow_node_id IS DISTINCT FROM OLD.workflow_node_id
     OR NEW.cell_id IS DISTINCT FROM OLD.cell_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'human task identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.aggregate_version IS DISTINCT FROM OLD.aggregate_version + 1 THEN
    RAISE EXCEPTION 'aggregate_version must advance by exactly one' USING ERRCODE = 'P0001';
  END IF;

  assignment_changed :=
       NEW.role_code IS DISTINCT FROM OLD.role_code
    OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
    OR NEW.office_id IS DISTINCT FROM OLD.office_id
    OR NEW.jurisdiction_id IS DISTINCT FROM OLD.jurisdiction_id
    OR NEW.service_scope_id IS DISTINCT FROM OLD.service_scope_id;

  IF NOT (
       (OLD.task_state = 'OPEN' AND NEW.task_state = 'CLAIMED'
          AND NOT assignment_changed AND NEW.claimed_principal_id IS NOT NULL)
    OR (OLD.task_state = 'CLAIMED' AND NEW.task_state = 'OPEN'
          AND NOT assignment_changed AND NEW.claimed_principal_id IS NULL)
    OR (OLD.task_state IN ('OPEN', 'CLAIMED') AND NEW.task_state = 'OPEN'
          AND assignment_changed AND NEW.claimed_principal_id IS NULL)
    OR (OLD.task_state = 'CLAIMED' AND NEW.task_state = 'COMPLETED'
          AND NOT assignment_changed
          AND NEW.claimed_principal_id IS NOT DISTINCT FROM OLD.claimed_principal_id)
    OR (OLD.task_state IN ('OPEN', 'CLAIMED') AND NEW.task_state = 'CANCELLED_CLOSED'
          AND NOT assignment_changed)
  ) THEN
    RAISE EXCEPTION 'human task transition % -> % refused', OLD.task_state, NEW.task_state
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_tasks.guard_task_transition() OWNER TO sf_migrator;

CREATE TRIGGER human_task_transition_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_tasks.human_task
  FOR EACH ROW
  EXECUTE FUNCTION sf_tasks.guard_task_transition();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_tasks FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_tasks FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_tasks FROM PUBLIC;

GRANT SELECT, INSERT,
  UPDATE (
    task_state, role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
    claimed_principal_id, claimed_at, outcome, aggregate_version, updated_at
  )
  ON sf_tasks.human_task TO sf_cmp017_rw;
GRANT SELECT, INSERT ON sf_tasks.task_history TO sf_cmp017_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_tasks.idempotency_record TO sf_cmp017_rw;

GRANT EXECUTE ON FUNCTION sf_tasks.reject_mutation() TO sf_cmp017_rw;
GRANT EXECUTE ON FUNCTION sf_tasks.guard_task_transition() TO sf_cmp017_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_tasks FROM sf_cmp017_rw;
REVOKE ALL ON SCHEMA sf_tasks FROM sf_app;
DROP SCHEMA IF EXISTS sf_tasks CASCADE;
-- Role sf_cmp017_rw retained (may be referenced by runtime logins); never DROP ROLE here.
