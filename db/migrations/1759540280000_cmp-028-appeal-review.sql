-- CMP-028 Appeal / Review (SF-M05-008). ADR-0006 Option A: sf_cmp028_rw NOLOGIN holds
-- DML; FORCE RLS on every tenant-scoped table; PUBLIC revoked; runtime is not table owner
-- (sf_migrator). Appeal never rewrites original CMP-015 case rows: original_application_id
-- and original_decision_id are opaque references (no FK, no cross-schema SQL). Appellate
-- authority is role + organisation/office + jurisdiction + service scope (Constitution #19);
-- no named-officer column. Admissibility and legal outcome are officer-recorded metadata,
-- never an LLM decision. Workflow instance ids are linkage metadata only (CMP-016 port).
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp028_rw') THEN
    CREATE ROLE sf_cmp028_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp028_rw IS
  'ADR-0006: CMP-028 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_appeal AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_appeal IS
  'isolation_class=TENANT_SCOPED; owner=CMP-028; appeal filing, admissibility, review and decision references';

REVOKE ALL ON SCHEMA sf_appeal FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_appeal TO sf_cmp028_rw;
GRANT USAGE ON SCHEMA sf_appeal TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_appeal REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_appeal REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_appeal REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_appeal.appeal TENANT_SCOPED owner=CMP-028
CREATE TABLE sf_appeal.appeal (
  tenant_id uuid NOT NULL,
  appeal_id uuid NOT NULL,
  original_application_id uuid NOT NULL,
  original_case_id uuid,
  original_decision_id uuid,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  appeal_state text NOT NULL CHECK (appeal_state IN (
    'FILED', 'ADMITTED', 'NOT_ADMITTED', 'IN_REVIEW',
    'DECISION_REFERENCED', 'WITHDRAWN', 'CANCELLED'
  )),
  grounds_code text NOT NULL CHECK (grounds_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  evidence_refs uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  admissibility_code text NOT NULL CHECK (admissibility_code IN ('PENDING', 'ADMITTED', 'NOT_ADMITTED')),
  admissibility_reason_code text CHECK (
    admissibility_reason_code IS NULL OR admissibility_reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
  ),
  role_code text NOT NULL CHECK (role_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  organisation_id uuid NOT NULL,
  office_id uuid,
  jurisdiction_id uuid NOT NULL,
  service_scope_id uuid,
  workflow_instance_id uuid,
  workflow_version_id uuid,
  hearing_ref uuid,
  review_ref uuid,
  decision_ref uuid,
  original_case_command_ref uuid,
  created_by uuid NOT NULL,
  correlation_id uuid NOT NULL,
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, appeal_id),
  CHECK (appeal_state <> 'FILED' OR admissibility_code = 'PENDING'),
  CHECK (appeal_state <> 'ADMITTED' OR admissibility_code = 'ADMITTED'),
  CHECK (appeal_state <> 'NOT_ADMITTED' OR admissibility_code = 'NOT_ADMITTED'),
  CHECK (
    appeal_state NOT IN ('IN_REVIEW', 'DECISION_REFERENCED')
    OR admissibility_code = 'ADMITTED'
  ),
  CHECK (appeal_state <> 'DECISION_REFERENCED' OR decision_ref IS NOT NULL)
);
CREATE INDEX appeal_original_application_idx
  ON sf_appeal.appeal (tenant_id, original_application_id);
CREATE INDEX appeal_state_idx ON sf_appeal.appeal (tenant_id, appeal_state);
ALTER TABLE sf_appeal.appeal ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_appeal.appeal FORCE ROW LEVEL SECURITY;
CREATE POLICY appeal_isolation ON sf_appeal.appeal TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_appeal.appeal OWNER TO sf_migrator;

-- sf:isolation sf_appeal.appeal_history TENANT_SCOPED owner=CMP-028
CREATE TABLE sf_appeal.appeal_history (
  tenant_id uuid NOT NULL,
  history_id uuid NOT NULL,
  appeal_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq >= 1),
  operation text NOT NULL CHECK (operation IN (
    'FILE', 'RECORD_ADMISSIBILITY', 'ASSIGN', 'REASSIGN', 'RECORD_REVIEW',
    'RECORD_HEARING', 'RECORD_DECISION', 'WITHDRAW', 'CANCEL', 'LINK_WORKFLOW'
  )),
  from_state text CHECK (from_state IS NULL OR from_state IN (
    'FILED', 'ADMITTED', 'NOT_ADMITTED', 'IN_REVIEW',
    'DECISION_REFERENCED', 'WITHDRAWN', 'CANCELLED'
  )),
  to_state text NOT NULL CHECK (to_state IN (
    'FILED', 'ADMITTED', 'NOT_ADMITTED', 'IN_REVIEW',
    'DECISION_REFERENCED', 'WITHDRAWN', 'CANCELLED'
  )),
  actor_type text NOT NULL CHECK (actor_type IN (
    'CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN'
  )),
  actor_id uuid NOT NULL,
  role_code text NOT NULL CHECK (role_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  organisation_id uuid NOT NULL,
  office_id uuid,
  jurisdiction_id uuid NOT NULL,
  service_scope_id uuid,
  admissibility_code text CHECK (admissibility_code IN ('PENDING', 'ADMITTED', 'NOT_ADMITTED')),
  review_ref uuid,
  hearing_ref uuid,
  decision_ref uuid,
  authz_decision_id uuid NOT NULL,
  policy_revision text NOT NULL CHECK (char_length(policy_revision) BETWEEN 1 AND 128),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, history_id),
  UNIQUE (tenant_id, appeal_id, seq),
  FOREIGN KEY (tenant_id, appeal_id) REFERENCES sf_appeal.appeal (tenant_id, appeal_id)
);
ALTER TABLE sf_appeal.appeal_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_appeal.appeal_history FORCE ROW LEVEL SECURITY;
CREATE POLICY appeal_history_isolation ON sf_appeal.appeal_history TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_appeal.appeal_history OWNER TO sf_migrator;

-- sf:isolation sf_appeal.assist_note TENANT_SCOPED owner=CMP-028
CREATE TABLE sf_appeal.assist_note (
  tenant_id uuid NOT NULL,
  note_id uuid NOT NULL,
  appeal_id uuid NOT NULL,
  note_kind text NOT NULL CHECK (note_kind IN ('SUMMARY', 'RETRIEVAL', 'DRAFT_NOTE', 'CHECKLIST')),
  content_ref text NOT NULL CHECK (char_length(content_ref) BETWEEN 8 AND 200),
  created_by uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, note_id),
  FOREIGN KEY (tenant_id, appeal_id) REFERENCES sf_appeal.appeal (tenant_id, appeal_id)
);
ALTER TABLE sf_appeal.assist_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_appeal.assist_note FORCE ROW LEVEL SECURITY;
CREATE POLICY assist_note_isolation ON sf_appeal.assist_note TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_appeal.assist_note OWNER TO sf_migrator;

-- sf:isolation sf_appeal.idempotency_record TENANT_SCOPED owner=CMP-028
CREATE TABLE sf_appeal.idempotency_record (
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
ALTER TABLE sf_appeal.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_appeal.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_appeal.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_appeal.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_appeal.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_appeal, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'insert-only appeal history or assist note'
    USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_appeal.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER appeal_history_immutable
  BEFORE UPDATE OR DELETE ON sf_appeal.appeal_history
  FOR EACH ROW
  EXECUTE FUNCTION sf_appeal.reject_mutation();

CREATE TRIGGER assist_note_immutable
  BEFORE UPDATE OR DELETE ON sf_appeal.assist_note
  FOR EACH ROW
  EXECUTE FUNCTION sf_appeal.reject_mutation();

CREATE FUNCTION sf_appeal.guard_appeal_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_appeal, pg_temp
AS $$
DECLARE
  authority_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'appeals are retained' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.appeal_state <> 'FILED' OR NEW.admissibility_code <> 'PENDING' THEN
      RAISE EXCEPTION 'appeal must start FILED with PENDING admissibility';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.appeal_state IN ('NOT_ADMITTED', 'DECISION_REFERENCED', 'WITHDRAWN', 'CANCELLED') THEN
    RAISE EXCEPTION 'terminal appeal % is immutable', OLD.appeal_state USING ERRCODE = 'P0001';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.appeal_id IS DISTINCT FROM OLD.appeal_id
     OR NEW.original_application_id IS DISTINCT FROM OLD.original_application_id
     OR NEW.cell_id IS DISTINCT FROM OLD.cell_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.grounds_code IS DISTINCT FROM OLD.grounds_code THEN
    RAISE EXCEPTION 'appeal identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.aggregate_version IS DISTINCT FROM OLD.aggregate_version + 1 THEN
    RAISE EXCEPTION 'aggregate_version must advance by exactly one' USING ERRCODE = 'P0001';
  END IF;

  authority_changed :=
       NEW.role_code IS DISTINCT FROM OLD.role_code
    OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
    OR NEW.office_id IS DISTINCT FROM OLD.office_id
    OR NEW.jurisdiction_id IS DISTINCT FROM OLD.jurisdiction_id
    OR NEW.service_scope_id IS DISTINCT FROM OLD.service_scope_id;

  IF NOT (
       (OLD.appeal_state = 'FILED' AND NEW.appeal_state = 'ADMITTED'
          AND NEW.admissibility_code = 'ADMITTED' AND NOT authority_changed)
    OR (OLD.appeal_state = 'FILED' AND NEW.appeal_state = 'NOT_ADMITTED'
          AND NEW.admissibility_code = 'NOT_ADMITTED' AND NOT authority_changed)
    OR (OLD.appeal_state IN ('ADMITTED', 'IN_REVIEW') AND NEW.appeal_state = 'IN_REVIEW'
          AND NEW.admissibility_code = 'ADMITTED')
    OR (OLD.appeal_state = 'IN_REVIEW' AND NEW.appeal_state = 'DECISION_REFERENCED'
          AND NEW.decision_ref IS NOT NULL AND NEW.admissibility_code = 'ADMITTED'
          AND NOT authority_changed)
    OR (OLD.appeal_state IN ('FILED', 'ADMITTED', 'IN_REVIEW')
          AND NEW.appeal_state IN ('WITHDRAWN', 'CANCELLED')
          AND NOT authority_changed)
    OR (OLD.appeal_state = NEW.appeal_state
          AND OLD.appeal_state IN ('FILED', 'ADMITTED', 'IN_REVIEW')
          AND NOT authority_changed
          AND (
            NEW.workflow_instance_id IS DISTINCT FROM OLD.workflow_instance_id
            OR NEW.workflow_version_id IS DISTINCT FROM OLD.workflow_version_id
            OR NEW.hearing_ref IS DISTINCT FROM OLD.hearing_ref
            OR NEW.review_ref IS DISTINCT FROM OLD.review_ref
            OR NEW.original_case_command_ref IS DISTINCT FROM OLD.original_case_command_ref
          ))
  ) THEN
    RAISE EXCEPTION 'appeal transition % -> % refused', OLD.appeal_state, NEW.appeal_state
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_appeal.guard_appeal_transition() OWNER TO sf_migrator;

CREATE TRIGGER appeal_transition_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_appeal.appeal
  FOR EACH ROW
  EXECUTE FUNCTION sf_appeal.guard_appeal_transition();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_appeal FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_appeal FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_appeal FROM PUBLIC;

GRANT SELECT, INSERT,
  UPDATE (
    appeal_state, admissibility_code, admissibility_reason_code,
    role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
    workflow_instance_id, workflow_version_id, hearing_ref, review_ref, decision_ref,
    original_case_command_ref, evidence_refs, original_case_id, original_decision_id,
    aggregate_version, updated_at
  )
  ON sf_appeal.appeal TO sf_cmp028_rw;
GRANT SELECT, INSERT ON sf_appeal.appeal_history TO sf_cmp028_rw;
GRANT SELECT, INSERT ON sf_appeal.assist_note TO sf_cmp028_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_appeal.idempotency_record TO sf_cmp028_rw;

GRANT EXECUTE ON FUNCTION sf_appeal.reject_mutation() TO sf_cmp028_rw;
GRANT EXECUTE ON FUNCTION sf_appeal.guard_appeal_transition() TO sf_cmp028_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_appeal FROM sf_cmp028_rw;
REVOKE ALL ON SCHEMA sf_appeal FROM sf_app;
DROP SCHEMA IF EXISTS sf_appeal CASCADE;
-- Role sf_cmp028_rw retained (may be referenced by runtime logins); never DROP ROLE here.
