-- CMP-061 Citizen Privacy & Data Rights Centre (SF-M09-006, INT-019 + INT-011).
-- ADR-0006 Option A: sf_cmp061_rw NOLOGIN holds DML; FORCE RLS; PUBLIC revoked; runtime is not the
-- table owner (sf_migrator).
-- SF-CON-PRIVACY-REQUEST (FROZEN): the Centre ORCHESTRATES owner-domain tasks. It stores the rights
-- request, its declared scope, one fulfilment task per scope item and an insert-only decision log.
-- It never reads or writes another component's tables (cross_component_direct_mutation_forbidden,
-- owner_task_orchestration_only); owners act on emitted task events and report outcomes back.
-- No privacy statute is encoded: legal bases / exceptions are opaque owner-supplied references
-- (POLICY_INPUT_REQUIRED), never interpreted, and no column stores a response deadline.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp061_rw') THEN
    CREATE ROLE sf_cmp061_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp061_rw IS
  'ADR-0006: CMP-061 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_privacy AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_privacy IS
  'isolation_class=TENANT_SCOPED; owner=CMP-061; privacy rights request orchestration only';

REVOKE ALL ON SCHEMA sf_privacy FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_privacy TO sf_cmp061_rw;
GRANT USAGE ON SCHEMA sf_privacy TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_privacy REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_privacy REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_privacy REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_privacy.privacy_request TENANT_SCOPED owner=CMP-061
CREATE TABLE sf_privacy.privacy_request (
  tenant_id uuid NOT NULL,
  request_id uuid NOT NULL,
  subject_actor_id uuid NOT NULL,
  request_type text NOT NULL CHECK (
    request_type IN ('ACCESS', 'CORRECTION', 'ERASURE', 'PORTABILITY', 'CONSENT_WITHDRAWAL', 'RESTRICT')
  ),
  lifecycle_status text NOT NULL CHECK (
    lifecycle_status IN ('SUBMITTED', 'TASKS_REQUESTED', 'COMPLETED', 'WITHDRAWN', 'DENIED_WITH_BASIS_REF')
  ),
  legal_basis_or_exception_ref text CHECK (
    legal_basis_or_exception_ref IS NULL
    OR legal_basis_or_exception_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$'
  ),
  submit_assurance text NOT NULL CHECK (submit_assurance IN ('OTP', 'PASSWORD', 'MFA')),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  request_version bigint NOT NULL CHECK (request_version >= 1),
  scope_count integer NOT NULL CHECK (scope_count BETWEEN 1 AND 32),
  invented_statutory_policy_forbidden boolean NOT NULL DEFAULT true
    CHECK (invented_statutory_policy_forbidden),
  cross_component_direct_mutation_forbidden boolean NOT NULL DEFAULT true
    CHECK (cross_component_direct_mutation_forbidden),
  owner_task_orchestration_only boolean NOT NULL DEFAULT true
    CHECK (owner_task_orchestration_only),
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_correlation_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, request_id),
  UNIQUE (tenant_id, subject_actor_id, idempotency_key),
  CHECK ((lifecycle_status = 'DENIED_WITH_BASIS_REF') = (legal_basis_or_exception_ref IS NOT NULL))
);
CREATE INDEX privacy_request_subject_idx
  ON sf_privacy.privacy_request (tenant_id, subject_actor_id, created_at DESC);
ALTER TABLE sf_privacy.privacy_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_privacy.privacy_request FORCE ROW LEVEL SECURITY;
CREATE POLICY privacy_request_isolation ON sf_privacy.privacy_request TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_privacy.privacy_request OWNER TO sf_migrator;

-- sf:isolation sf_privacy.privacy_request_scope TENANT_SCOPED owner=CMP-061
CREATE TABLE sf_privacy.privacy_request_scope (
  tenant_id uuid NOT NULL,
  request_id uuid NOT NULL,
  scope_seq integer NOT NULL CHECK (scope_seq BETWEEN 1 AND 32),
  owner_component text NOT NULL CHECK (
    owner_component ~ '^CMP-0[0-9]{2}$' AND owner_component <> 'CMP-061'
  ),
  scope_ref text NOT NULL CHECK (scope_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, request_id, scope_seq),
  UNIQUE (tenant_id, request_id, scope_seq, owner_component),
  UNIQUE (tenant_id, request_id, owner_component, scope_ref),
  FOREIGN KEY (tenant_id, request_id) REFERENCES sf_privacy.privacy_request (tenant_id, request_id)
);
ALTER TABLE sf_privacy.privacy_request_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_privacy.privacy_request_scope FORCE ROW LEVEL SECURITY;
CREATE POLICY privacy_request_scope_isolation ON sf_privacy.privacy_request_scope TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_privacy.privacy_request_scope OWNER TO sf_migrator;

-- sf:isolation sf_privacy.privacy_fulfilment_task TENANT_SCOPED owner=CMP-061
CREATE TABLE sf_privacy.privacy_fulfilment_task (
  tenant_id uuid NOT NULL,
  task_id uuid NOT NULL,
  request_id uuid NOT NULL,
  scope_seq integer NOT NULL,
  owner_component text NOT NULL,
  task_status text NOT NULL CHECK (
    task_status IN ('REQUESTED', 'COMPLETED', 'EXCEPTION_RECORDED', 'CANCELLED')
  ),
  evidence_ref text CHECK (
    evidence_ref IS NULL OR evidence_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$'
  ),
  legal_basis_or_exception_ref text CHECK (
    legal_basis_or_exception_ref IS NULL
    OR legal_basis_or_exception_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$'
  ),
  exception_authority_ref text CHECK (
    exception_authority_ref IS NULL
    OR exception_authority_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$'
  ),
  task_version bigint NOT NULL CHECK (task_version >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_correlation_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, task_id),
  UNIQUE (tenant_id, request_id, scope_seq),
  FOREIGN KEY (tenant_id, request_id, scope_seq, owner_component)
    REFERENCES sf_privacy.privacy_request_scope (tenant_id, request_id, scope_seq, owner_component),
  CHECK (task_status <> 'COMPLETED' OR evidence_ref IS NOT NULL),
  CHECK (
    task_status <> 'EXCEPTION_RECORDED'
    OR (legal_basis_or_exception_ref IS NOT NULL AND exception_authority_ref IS NOT NULL)
  ),
  CHECK (
    task_status = 'EXCEPTION_RECORDED'
    OR (legal_basis_or_exception_ref IS NULL AND exception_authority_ref IS NULL)
  )
);
CREATE INDEX privacy_fulfilment_task_request_idx
  ON sf_privacy.privacy_fulfilment_task (tenant_id, request_id, task_status);
ALTER TABLE sf_privacy.privacy_fulfilment_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_privacy.privacy_fulfilment_task FORCE ROW LEVEL SECURITY;
CREATE POLICY privacy_fulfilment_task_isolation ON sf_privacy.privacy_fulfilment_task TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_privacy.privacy_fulfilment_task OWNER TO sf_migrator;

-- sf:isolation sf_privacy.privacy_decision TENANT_SCOPED owner=CMP-061
CREATE TABLE sf_privacy.privacy_decision (
  tenant_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  request_id uuid NOT NULL,
  from_status text CHECK (
    from_status IS NULL
    OR from_status IN ('SUBMITTED', 'TASKS_REQUESTED', 'COMPLETED', 'WITHDRAWN', 'DENIED_WITH_BASIS_REF')
  ),
  to_status text NOT NULL CHECK (
    to_status IN ('SUBMITTED', 'TASKS_REQUESTED', 'COMPLETED', 'WITHDRAWN', 'DENIED_WITH_BASIS_REF')
  ),
  legal_basis_or_exception_ref text,
  request_version bigint NOT NULL CHECK (request_version >= 1),
  actor_type text NOT NULL CHECK (
    actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')
  ),
  actor_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  decided_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, decision_id),
  UNIQUE (tenant_id, request_id, request_version),
  FOREIGN KEY (tenant_id, request_id) REFERENCES sf_privacy.privacy_request (tenant_id, request_id),
  CHECK (from_status IS DISTINCT FROM to_status),
  CHECK ((to_status = 'DENIED_WITH_BASIS_REF') = (legal_basis_or_exception_ref IS NOT NULL))
);
ALTER TABLE sf_privacy.privacy_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_privacy.privacy_decision FORCE ROW LEVEL SECURITY;
CREATE POLICY privacy_decision_isolation ON sf_privacy.privacy_decision TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_privacy.privacy_decision OWNER TO sf_migrator;

-- sf:isolation sf_privacy.idempotency_record TENANT_SCOPED owner=CMP-061
CREATE TABLE sf_privacy.idempotency_record (
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
ALTER TABLE sf_privacy.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_privacy.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_privacy.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_privacy.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_privacy.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_privacy, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'insert-only privacy row' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_privacy.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER privacy_decision_immutable
  BEFORE UPDATE OR DELETE ON sf_privacy.privacy_decision
  FOR EACH ROW EXECUTE FUNCTION sf_privacy.reject_mutation();

CREATE TRIGGER privacy_request_scope_immutable
  BEFORE UPDATE OR DELETE ON sf_privacy.privacy_request_scope
  FOR EACH ROW EXECUTE FUNCTION sf_privacy.reject_mutation();

-- Scope is declared once, with the request, while it is still SUBMITTED at version 1.
CREATE FUNCTION sf_privacy.guard_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_privacy, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sf_privacy.privacy_request
     WHERE tenant_id = NEW.tenant_id AND request_id = NEW.request_id
       AND lifecycle_status = 'SUBMITTED' AND request_version = 1
  ) THEN
    RAISE EXCEPTION 'scope is declared only at submission'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_privacy.guard_scope() OWNER TO sf_migrator;

CREATE TRIGGER privacy_request_scope_guard
  BEFORE INSERT ON sf_privacy.privacy_request_scope
  FOR EACH ROW EXECUTE FUNCTION sf_privacy.guard_scope();

-- Lifecycle: SUBMITTED -> TASKS_REQUESTED | WITHDRAWN | DENIED_WITH_BASIS_REF;
-- TASKS_REQUESTED -> COMPLETED | WITHDRAWN | DENIED_WITH_BASIS_REF. Terminal states never change.
-- COMPLETED needs every owner task terminal (completed with evidence or exception recorded).
CREATE FUNCTION sf_privacy.guard_request()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_privacy, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'privacy requests are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_status <> 'SUBMITTED' OR NEW.request_version <> 1 THEN
      RAISE EXCEPTION 'a privacy request is submitted at version 1'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.request_id, NEW.subject_actor_id, NEW.request_type, NEW.submit_assurance,
      NEW.idempotency_key, NEW.scope_count, NEW.correlation_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.request_id, OLD.subject_actor_id, OLD.request_type, OLD.submit_assurance,
      OLD.idempotency_key, OLD.scope_count, OLD.correlation_id, OLD.created_at) THEN
    RAISE EXCEPTION 'privacy request identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.lifecycle_status IN ('COMPLETED', 'WITHDRAWN', 'DENIED_WITH_BASIS_REF') THEN
    RAISE EXCEPTION 'privacy request is terminal'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  IF NEW.request_version <> OLD.request_version + 1 THEN
    RAISE EXCEPTION 'request_version must advance by one'
      USING ERRCODE = 'P0001', HINT = 'SF_STALE_VERSION';
  END IF;
  IF NOT (
       (OLD.lifecycle_status = 'SUBMITTED'
         AND NEW.lifecycle_status IN ('TASKS_REQUESTED', 'WITHDRAWN', 'DENIED_WITH_BASIS_REF'))
    OR (OLD.lifecycle_status = 'TASKS_REQUESTED'
         AND NEW.lifecycle_status IN ('COMPLETED', 'WITHDRAWN', 'DENIED_WITH_BASIS_REF'))
  ) THEN
    RAISE EXCEPTION 'privacy request transition not permitted'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  IF NEW.lifecycle_status = 'COMPLETED' AND (
       NOT EXISTS (SELECT 1 FROM sf_privacy.privacy_fulfilment_task
                    WHERE tenant_id = NEW.tenant_id AND request_id = NEW.request_id)
    OR EXISTS (SELECT 1 FROM sf_privacy.privacy_fulfilment_task
                WHERE tenant_id = NEW.tenant_id AND request_id = NEW.request_id
                  AND task_status NOT IN ('COMPLETED', 'EXCEPTION_RECORDED'))
  ) THEN
    RAISE EXCEPTION 'completion requires an outcome from every owner task'
      USING ERRCODE = 'P0001', HINT = 'SF_TASKS_OPEN';
  END IF;
  IF NEW.lifecycle_status IN ('WITHDRAWN', 'DENIED_WITH_BASIS_REF') AND EXISTS (
       SELECT 1 FROM sf_privacy.privacy_fulfilment_task
        WHERE tenant_id = NEW.tenant_id AND request_id = NEW.request_id AND task_status = 'REQUESTED'
  ) THEN
    RAISE EXCEPTION 'open owner tasks must be cancelled first'
      USING ERRCODE = 'P0001', HINT = 'SF_TASKS_OPEN';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_privacy.guard_request() OWNER TO sf_migrator;

CREATE TRIGGER privacy_request_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_privacy.privacy_request
  FOR EACH ROW EXECUTE FUNCTION sf_privacy.guard_request();

-- A task is created REQUESTED while its request is TASKS_REQUESTED and is resolved exactly once.
CREATE FUNCTION sf_privacy.guard_task()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_privacy, pg_temp
AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'privacy fulfilment tasks are never deleted' USING ERRCODE = '42501';
  END IF;
  SELECT lifecycle_status INTO parent_status FROM sf_privacy.privacy_request
   WHERE tenant_id = NEW.tenant_id AND request_id = NEW.request_id;
  IF TG_OP = 'INSERT' THEN
    IF NEW.task_status <> 'REQUESTED' OR NEW.task_version <> 1 THEN
      RAISE EXCEPTION 'a fulfilment task is created REQUESTED at version 1'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
    IF parent_status IS DISTINCT FROM 'TASKS_REQUESTED' THEN
      RAISE EXCEPTION 'tasks are created only when the request is TASKS_REQUESTED'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.task_id, NEW.request_id, NEW.scope_seq, NEW.owner_component, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.task_id, OLD.request_id, OLD.scope_seq, OLD.owner_component, OLD.created_at) THEN
    RAISE EXCEPTION 'fulfilment task identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.task_status <> 'REQUESTED' OR NEW.task_status = 'REQUESTED' THEN
    RAISE EXCEPTION 'a fulfilment task is resolved exactly once'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  IF NEW.task_version <> OLD.task_version + 1 THEN
    RAISE EXCEPTION 'task_version must advance by one'
      USING ERRCODE = 'P0001', HINT = 'SF_STALE_VERSION';
  END IF;
  IF parent_status IS DISTINCT FROM 'TASKS_REQUESTED' THEN
    RAISE EXCEPTION 'task outcomes are accepted only while the request is TASKS_REQUESTED'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_privacy.guard_task() OWNER TO sf_migrator;

CREATE TRIGGER privacy_fulfilment_task_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_privacy.privacy_fulfilment_task
  FOR EACH ROW EXECUTE FUNCTION sf_privacy.guard_task();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_privacy FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_privacy FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_privacy FROM PUBLIC;

GRANT SELECT, INSERT,
  UPDATE (lifecycle_status, legal_basis_or_exception_ref, request_version, updated_at, last_correlation_id)
  ON sf_privacy.privacy_request TO sf_cmp061_rw;
GRANT SELECT, INSERT ON sf_privacy.privacy_request_scope TO sf_cmp061_rw;
GRANT SELECT, INSERT,
  UPDATE (task_status, evidence_ref, legal_basis_or_exception_ref, exception_authority_ref,
          task_version, updated_at, last_correlation_id)
  ON sf_privacy.privacy_fulfilment_task TO sf_cmp061_rw;
GRANT SELECT, INSERT ON sf_privacy.privacy_decision TO sf_cmp061_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_privacy.idempotency_record TO sf_cmp061_rw;

GRANT EXECUTE ON FUNCTION sf_privacy.reject_mutation() TO sf_cmp061_rw;
GRANT EXECUTE ON FUNCTION sf_privacy.guard_scope() TO sf_cmp061_rw;
GRANT EXECUTE ON FUNCTION sf_privacy.guard_request() TO sf_cmp061_rw;
GRANT EXECUTE ON FUNCTION sf_privacy.guard_task() TO sf_cmp061_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_privacy FROM sf_cmp061_rw;
REVOKE ALL ON SCHEMA sf_privacy FROM sf_app;
DROP SCHEMA IF EXISTS sf_privacy CASCADE;
-- Role sf_cmp061_rw retained (may be referenced by runtime logins); never DROP ROLE here.
