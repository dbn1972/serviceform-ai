-- CMP-018 Inspection / Verification (SF-M05-005). ADR-0006 Option A: sf_cmp018_rw NOLOGIN holds
-- DML; FORCE RLS on every tenant-scoped table; PUBLIC revoked; runtime is not table owner
-- (sf_migrator). Assignment is criteria only: role + organisation/office + jurisdiction + service
-- scope (Constitution #19). Inspection verification_result is never statutory approval/rejection
-- or eligibility; statutory_effect is constrained false. Scheduling columns are metadata only
-- (not M09 CMP-056 calendars). No FK into CMP-015/011/013/014 tables.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp018_rw') THEN
    CREATE ROLE sf_cmp018_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp018_rw IS
  'ADR-0006: CMP-018 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_inspection AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_inspection IS
  'isolation_class=TENANT_SCOPED; owner=CMP-018; inspection request, checklist, observations, findings';

REVOKE ALL ON SCHEMA sf_inspection FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_inspection TO sf_cmp018_rw;
GRANT USAGE ON SCHEMA sf_inspection TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_inspection REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_inspection REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_inspection REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_inspection.inspection TENANT_SCOPED owner=CMP-018
CREATE TABLE sf_inspection.inspection (
  tenant_id uuid NOT NULL,
  inspection_id uuid NOT NULL,
  application_id uuid NOT NULL,
  prior_inspection_id uuid,
  workflow_node_id text CHECK (workflow_node_id IS NULL OR workflow_node_id ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  inspection_state text NOT NULL CHECK (inspection_state IN (
    'REQUESTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
  )),
  role_code text NOT NULL CHECK (role_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  organisation_id uuid NOT NULL,
  office_id uuid,
  jurisdiction_id uuid NOT NULL,
  service_scope_id uuid,
  claimed_principal_id uuid,
  claimed_at timestamptz,
  window_start timestamptz,
  window_end timestamptz,
  slot_ref text CHECK (slot_ref IS NULL OR slot_ref ~ '^[A-Za-z0-9_.:/-]{1,128}$'),
  location_ref text CHECK (location_ref IS NULL OR location_ref ~ '^[A-Za-z0-9_.:/-]{1,128}$'),
  timezone_iana text CHECK (timezone_iana IS NULL OR timezone_iana ~ '^[A-Za-z0-9_+\-/]{1,64}$'),
  verification_result text CHECK (verification_result IS NULL OR verification_result IN (
    'VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE', 'DEFICIENCY_NOTED'
  )),
  statutory_effect boolean NOT NULL DEFAULT false CHECK (statutory_effect = false),
  created_by uuid NOT NULL,
  correlation_id uuid NOT NULL,
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, inspection_id),
  CHECK (window_end IS NULL OR window_start IS NULL OR window_end >= window_start),
  CHECK (inspection_state <> 'COMPLETED' OR verification_result IS NOT NULL),
  CHECK (inspection_state <> 'IN_PROGRESS' OR claimed_principal_id IS NOT NULL),
  CHECK (inspection_state IN ('REQUESTED', 'SCHEDULED', 'CANCELLED') OR claimed_principal_id IS NOT NULL OR inspection_state = 'COMPLETED'),
  FOREIGN KEY (tenant_id, prior_inspection_id)
    REFERENCES sf_inspection.inspection (tenant_id, inspection_id)
);
CREATE INDEX inspection_application_idx ON sf_inspection.inspection (tenant_id, application_id);
CREATE INDEX inspection_available_idx
  ON sf_inspection.inspection (tenant_id, role_code, organisation_id, jurisdiction_id)
  WHERE inspection_state IN ('REQUESTED', 'SCHEDULED');
ALTER TABLE sf_inspection.inspection ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_inspection.inspection FORCE ROW LEVEL SECURITY;
CREATE POLICY inspection_isolation ON sf_inspection.inspection TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_inspection.inspection OWNER TO sf_migrator;

-- sf:isolation sf_inspection.inspection_history TENANT_SCOPED owner=CMP-018
CREATE TABLE sf_inspection.inspection_history (
  tenant_id uuid NOT NULL,
  history_id uuid NOT NULL,
  inspection_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq >= 1),
  operation text NOT NULL CHECK (operation IN (
    'CREATE', 'SCHEDULE', 'REASSIGN', 'START', 'RECORD_CHECKLIST', 'RECORD_OBSERVATION',
    'ATTACH_EVIDENCE', 'RECORD_FINDING', 'RECORD_RESULT', 'COMPLETE', 'CANCEL', 'REINSPECT'
  )),
  from_state text CHECK (from_state IS NULL OR from_state IN (
    'REQUESTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
  )),
  to_state text NOT NULL CHECK (to_state IN (
    'REQUESTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
  )),
  actor_type text NOT NULL CHECK (actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  actor_id uuid NOT NULL,
  role_code text NOT NULL CHECK (role_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  organisation_id uuid NOT NULL,
  office_id uuid,
  jurisdiction_id uuid NOT NULL,
  service_scope_id uuid,
  claimed_principal_id uuid,
  verification_result text CHECK (verification_result IS NULL OR verification_result IN (
    'VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE', 'DEFICIENCY_NOTED'
  )),
  statutory_effect boolean NOT NULL DEFAULT false CHECK (statutory_effect = false),
  authz_decision_id uuid NOT NULL,
  policy_revision text NOT NULL CHECK (char_length(policy_revision) BETWEEN 1 AND 128),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, history_id),
  UNIQUE (tenant_id, inspection_id, seq),
  FOREIGN KEY (tenant_id, inspection_id) REFERENCES sf_inspection.inspection (tenant_id, inspection_id)
);
ALTER TABLE sf_inspection.inspection_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_inspection.inspection_history FORCE ROW LEVEL SECURITY;
CREATE POLICY inspection_history_isolation ON sf_inspection.inspection_history TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_inspection.inspection_history OWNER TO sf_migrator;

-- sf:isolation sf_inspection.checklist_item TENANT_SCOPED owner=CMP-018
CREATE TABLE sf_inspection.checklist_item (
  tenant_id uuid NOT NULL,
  item_id uuid NOT NULL,
  inspection_id uuid NOT NULL,
  item_code text NOT NULL CHECK (item_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  required boolean NOT NULL DEFAULT true,
  item_state text NOT NULL CHECK (item_state IN ('PENDING', 'SATISFIED', 'NOT_SATISFIED', 'NOT_APPLICABLE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, item_id),
  UNIQUE (tenant_id, inspection_id, item_code),
  FOREIGN KEY (tenant_id, inspection_id) REFERENCES sf_inspection.inspection (tenant_id, inspection_id)
);
ALTER TABLE sf_inspection.checklist_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_inspection.checklist_item FORCE ROW LEVEL SECURITY;
CREATE POLICY checklist_item_isolation ON sf_inspection.checklist_item TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_inspection.checklist_item OWNER TO sf_migrator;

-- sf:isolation sf_inspection.observation TENANT_SCOPED owner=CMP-018
CREATE TABLE sf_inspection.observation (
  tenant_id uuid NOT NULL,
  observation_id uuid NOT NULL,
  inspection_id uuid NOT NULL,
  item_code text NOT NULL CHECK (item_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  note_ref text NOT NULL CHECK (note_ref ~ '^[A-Za-z0-9_.:/-]{1,200}$'),
  geo_ref text CHECK (geo_ref IS NULL OR geo_ref ~ '^[A-Za-z0-9_.:/-]{1,200}$'),
  captured_at timestamptz NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, observation_id),
  FOREIGN KEY (tenant_id, inspection_id) REFERENCES sf_inspection.inspection (tenant_id, inspection_id)
);
ALTER TABLE sf_inspection.observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_inspection.observation FORCE ROW LEVEL SECURITY;
CREATE POLICY observation_isolation ON sf_inspection.observation TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_inspection.observation OWNER TO sf_migrator;

-- sf:isolation sf_inspection.evidence_ref TENANT_SCOPED owner=CMP-018
CREATE TABLE sf_inspection.evidence_ref (
  tenant_id uuid NOT NULL,
  evidence_ref_id uuid NOT NULL,
  inspection_id uuid NOT NULL,
  evidence_id uuid,
  document_id uuid,
  ocr_job_id uuid,
  technical_acceptance text NOT NULL CHECK (technical_acceptance IN (
    'PENDING', 'ACCEPTED', 'REJECTED_TECHNICAL'
  )),
  simulation_marker jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, evidence_ref_id),
  CHECK (evidence_id IS NOT NULL OR document_id IS NOT NULL),
  FOREIGN KEY (tenant_id, inspection_id) REFERENCES sf_inspection.inspection (tenant_id, inspection_id)
);
ALTER TABLE sf_inspection.evidence_ref ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_inspection.evidence_ref FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_ref_isolation ON sf_inspection.evidence_ref TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_inspection.evidence_ref OWNER TO sf_migrator;

-- sf:isolation sf_inspection.finding TENANT_SCOPED owner=CMP-018
CREATE TABLE sf_inspection.finding (
  tenant_id uuid NOT NULL,
  finding_id uuid NOT NULL,
  inspection_id uuid NOT NULL,
  finding_code text NOT NULL CHECK (finding_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  severity text NOT NULL CHECK (severity IN ('INFO', 'ADVISORY', 'MATERIAL')),
  related_item_code text CHECK (related_item_code IS NULL OR related_item_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, finding_id),
  FOREIGN KEY (tenant_id, inspection_id) REFERENCES sf_inspection.inspection (tenant_id, inspection_id)
);
ALTER TABLE sf_inspection.finding ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_inspection.finding FORCE ROW LEVEL SECURITY;
CREATE POLICY finding_isolation ON sf_inspection.finding TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_inspection.finding OWNER TO sf_migrator;

-- sf:isolation sf_inspection.idempotency_record TENANT_SCOPED owner=CMP-018
CREATE TABLE sf_inspection.idempotency_record (
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
ALTER TABLE sf_inspection.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_inspection.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_inspection.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_inspection.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_inspection.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_inspection, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'append-only inspection row'
    USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_inspection.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER inspection_history_immutable
  BEFORE UPDATE OR DELETE ON sf_inspection.inspection_history
  FOR EACH ROW
  EXECUTE FUNCTION sf_inspection.reject_mutation();

CREATE TRIGGER observation_immutable
  BEFORE UPDATE OR DELETE ON sf_inspection.observation
  FOR EACH ROW
  EXECUTE FUNCTION sf_inspection.reject_mutation();

CREATE TRIGGER evidence_ref_immutable
  BEFORE UPDATE OR DELETE ON sf_inspection.evidence_ref
  FOR EACH ROW
  EXECUTE FUNCTION sf_inspection.reject_mutation();

CREATE TRIGGER finding_immutable
  BEFORE UPDATE OR DELETE ON sf_inspection.finding
  FOR EACH ROW
  EXECUTE FUNCTION sf_inspection.reject_mutation();

CREATE FUNCTION sf_inspection.guard_inspection_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_inspection, pg_temp
AS $$
DECLARE
  assignment_changed boolean;
  schedule_set boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inspections are retained' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.inspection_state <> 'REQUESTED' THEN
      RAISE EXCEPTION 'inspection must start REQUESTED';
    END IF;
    IF NEW.verification_result IS NOT NULL THEN
      RAISE EXCEPTION 'inspection must start without a verification result';
    END IF;
    IF NEW.statutory_effect IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'inspection statutory_effect must remain false';
    END IF;
    IF NEW.claimed_principal_id IS NOT NULL THEN
      RAISE EXCEPTION 'inspection must start unclaimed';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.inspection_state IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'terminal inspection % is immutable', OLD.inspection_state USING ERRCODE = 'P0001';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.inspection_id IS DISTINCT FROM OLD.inspection_id
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.prior_inspection_id IS DISTINCT FROM OLD.prior_inspection_id
     OR NEW.workflow_node_id IS DISTINCT FROM OLD.workflow_node_id
     OR NEW.cell_id IS DISTINCT FROM OLD.cell_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'inspection identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.statutory_effect IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'inspection statutory_effect must remain false' USING ERRCODE = 'P0001';
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

  schedule_set :=
       NEW.window_start IS DISTINCT FROM OLD.window_start
    OR NEW.window_end IS DISTINCT FROM OLD.window_end
    OR NEW.slot_ref IS DISTINCT FROM OLD.slot_ref
    OR NEW.location_ref IS DISTINCT FROM OLD.location_ref
    OR NEW.timezone_iana IS DISTINCT FROM OLD.timezone_iana;

  IF NOT (
       (OLD.inspection_state = 'REQUESTED' AND NEW.inspection_state = 'SCHEDULED'
          AND NOT assignment_changed AND schedule_set)
    OR (OLD.inspection_state IN ('REQUESTED', 'SCHEDULED') AND NEW.inspection_state = OLD.inspection_state
          AND assignment_changed
          AND NEW.claimed_principal_id IS NOT DISTINCT FROM OLD.claimed_principal_id)
    OR (OLD.inspection_state IN ('REQUESTED', 'SCHEDULED') AND NEW.inspection_state = 'IN_PROGRESS'
          AND NOT assignment_changed AND NEW.claimed_principal_id IS NOT NULL)
    OR (OLD.inspection_state = 'IN_PROGRESS' AND NEW.inspection_state = 'IN_PROGRESS'
          AND NOT assignment_changed
          AND NEW.claimed_principal_id IS NOT DISTINCT FROM OLD.claimed_principal_id)
    OR (OLD.inspection_state = 'IN_PROGRESS' AND NEW.inspection_state = 'COMPLETED'
          AND NOT assignment_changed AND NEW.verification_result IS NOT NULL)
    OR (OLD.inspection_state IN ('REQUESTED', 'SCHEDULED', 'IN_PROGRESS') AND NEW.inspection_state = 'CANCELLED'
          AND NOT assignment_changed)
  ) THEN
    RAISE EXCEPTION 'inspection transition % -> % refused', OLD.inspection_state, NEW.inspection_state
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_inspection.guard_inspection_transition() OWNER TO sf_migrator;

CREATE TRIGGER inspection_transition_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_inspection.inspection
  FOR EACH ROW
  EXECUTE FUNCTION sf_inspection.guard_inspection_transition();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_inspection FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_inspection FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_inspection FROM PUBLIC;

GRANT SELECT, INSERT,
  UPDATE (
    inspection_state, role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
    claimed_principal_id, claimed_at, window_start, window_end, slot_ref, location_ref,
    timezone_iana, verification_result, aggregate_version, updated_at
  )
  ON sf_inspection.inspection TO sf_cmp018_rw;
GRANT SELECT, INSERT ON sf_inspection.inspection_history TO sf_cmp018_rw;
GRANT SELECT, INSERT, UPDATE (item_state, updated_at) ON sf_inspection.checklist_item TO sf_cmp018_rw;
GRANT SELECT, INSERT ON sf_inspection.observation TO sf_cmp018_rw;
GRANT SELECT, INSERT ON sf_inspection.evidence_ref TO sf_cmp018_rw;
GRANT SELECT, INSERT ON sf_inspection.finding TO sf_cmp018_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_inspection.idempotency_record TO sf_cmp018_rw;

GRANT EXECUTE ON FUNCTION sf_inspection.reject_mutation() TO sf_cmp018_rw;
GRANT EXECUTE ON FUNCTION sf_inspection.guard_inspection_transition() TO sf_cmp018_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_inspection FROM sf_cmp018_rw;
REVOKE ALL ON SCHEMA sf_inspection FROM sf_app;
DROP SCHEMA IF EXISTS sf_inspection CASCADE;
-- Role sf_cmp018_rw retained (may be referenced by runtime logins); never DROP ROLE here.
