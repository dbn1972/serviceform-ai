-- CMP-015 Application / Case Management (SF-M05-001). ADR-0006 Option A: sf_cmp015_rw NOLOGIN
-- holds DML; FORCE RLS; PUBLIC revoked; runtime is not table owner (sf_migrator).
-- CMP-015 is the sole owner of authoritative application/case state (Constitution #10;
-- SF-CON-APPLICATION-CASE-SM). The state CHECK admits AWS v1.7 s12.1 legal states only:
-- WITHDRAWAL_REQUESTED / CANCELLATION_REQUESTED are workflow request constructs (ADR-0003), never
-- a case state. Triggers enforce the frozen transition table, +1 aggregate versions, immutable
-- version pins (Constitution #8, #9, #35; SF-CON-VERSION-PINNING) and the committed-request gate
-- for WITHDRAWN / CANCELLED. No PII beyond opaque actor/applicant ids is stored here.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp015_rw') THEN
    CREATE ROLE sf_cmp015_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp015_rw IS
  'ADR-0006: CMP-015 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_application_case AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_application_case IS
  'isolation_class=mixed; owner=CMP-015; authoritative application/case state, transitions, request references';

REVOKE ALL ON SCHEMA sf_application_case FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_application_case TO sf_cmp015_rw;
GRANT USAGE ON SCHEMA sf_application_case TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_application_case REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_application_case REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_application_case REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_application_case.application_case TENANT_SCOPED owner=CMP-015
CREATE TABLE sf_application_case.application_case (
  application_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  service_id uuid NOT NULL,
  applicant_id uuid NOT NULL,
  organisation_id uuid,
  jurisdiction_id uuid,
  state text NOT NULL CHECK (state IN (
    'DRAFT', 'READY_TO_SUBMIT', 'SUBMITTED', 'PAYMENT_PENDING', 'RECEIVED', 'UNDER_SCRUTINY',
    'DEFICIENCY_RAISED', 'CITIZEN_RESPONSE', 'VERIFICATION', 'DECISION_PENDING', 'APPROVED',
    'REJECTED', 'SIGNING_PENDING', 'ISSUED', 'CLOSED', 'WITHDRAWN', 'CANCELLED'
  )),
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 1),
  tenant_service_binding_id uuid NOT NULL,
  form_version_id uuid NOT NULL,
  rule_version_id uuid NOT NULL,
  workflow_version_id uuid NOT NULL,
  evidence_policy_version_id uuid NOT NULL,
  sla_policy_version_id uuid NOT NULL,
  fee_policy_version_id uuid,
  credential_template_version_id uuid,
  notification_version_id uuid,
  authorization_policy_version_id uuid,
  pin_graph_hash text NOT NULL CHECK (pin_graph_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  submitted_at timestamptz,
  last_correlation_id uuid NOT NULL,
  UNIQUE (tenant_id, application_id)
);
CREATE INDEX application_case_state_idx
  ON sf_application_case.application_case (tenant_id, state, updated_at DESC);
CREATE INDEX application_case_applicant_idx
  ON sf_application_case.application_case (tenant_id, applicant_id, created_at DESC);
ALTER TABLE sf_application_case.application_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_application_case.application_case FORCE ROW LEVEL SECURITY;
CREATE POLICY application_case_tenant ON sf_application_case.application_case TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_application_case.application_case OWNER TO sf_migrator;

-- Local reference to a withdrawal/cancellation workflow request construct (ADR-0003). The
-- request record itself belongs to CMP-016/CMP-017; CMP-015 keeps only the committed-resolution
-- reference it needs to gate WITHDRAWN / CANCELLED. Never an application state.
-- sf:isolation sf_application_case.case_request_reference TENANT_SCOPED owner=CMP-015
CREATE TABLE sf_application_case.case_request_reference (
  request_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  application_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('WITHDRAWAL', 'CANCELLATION')),
  status text NOT NULL CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'REJECTED', 'EXPIRED', 'COMMITTED')),
  workflow_ref text CHECK (workflow_ref IS NULL OR char_length(workflow_ref) BETWEEN 1 AND 200),
  status_reason_code text CHECK (status_reason_code IS NULL OR status_reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  case_state_at_request text NOT NULL,
  consumed_at_version bigint CHECK (consumed_at_version IS NULL OR consumed_at_version >= 2),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_correlation_id uuid NOT NULL,
  UNIQUE (tenant_id, request_id),
  FOREIGN KEY (tenant_id, application_id)
    REFERENCES sf_application_case.application_case (tenant_id, application_id),
  CHECK (consumed_at_version IS NULL OR status = 'COMMITTED')
);
CREATE UNIQUE INDEX case_request_reference_open_uniq
  ON sf_application_case.case_request_reference (tenant_id, application_id, kind)
  WHERE status IN ('SUBMITTED', 'UNDER_REVIEW') OR (status = 'COMMITTED' AND consumed_at_version IS NULL);
ALTER TABLE sf_application_case.case_request_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_application_case.case_request_reference FORCE ROW LEVEL SECURITY;
CREATE POLICY case_request_reference_tenant ON sf_application_case.case_request_reference TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_application_case.case_request_reference OWNER TO sf_migrator;

-- sf:isolation sf_application_case.case_transition TENANT_SCOPED owner=CMP-015
CREATE TABLE sf_application_case.case_transition (
  transition_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  application_id uuid NOT NULL,
  command text NOT NULL CHECK (command ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  from_state text,
  to_state text NOT NULL,
  transition_key text,
  transition_class text CHECK (transition_class IS NULL OR transition_class IN (
    'ALWAYS_LEGAL', 'POLICY_GATED_WITHDRAWAL', 'POLICY_GATED_CANCELLATION'
  )),
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 1),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  authz_decision_id uuid NOT NULL,
  authz_policy_revision text NOT NULL CHECK (char_length(authz_policy_revision) BETWEEN 1 AND 128),
  correlation_id uuid NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  actor_id uuid NOT NULL,
  reason_code text CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  request_id uuid,
  policy_ref text CHECK (policy_ref IS NULL OR char_length(policy_ref) BETWEEN 1 AND 200),
  occurred_at timestamptz NOT NULL,
  UNIQUE (tenant_id, application_id, aggregate_version),
  FOREIGN KEY (tenant_id, application_id)
    REFERENCES sf_application_case.application_case (tenant_id, application_id),
  CHECK ((from_state IS NULL) = (transition_key IS NULL)),
  CHECK (CASE WHEN transition_class IN ('POLICY_GATED_WITHDRAWAL', 'POLICY_GATED_CANCELLATION')
              THEN request_id IS NOT NULL ELSE request_id IS NULL END)
);
ALTER TABLE sf_application_case.case_transition ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_application_case.case_transition FORCE ROW LEVEL SECURITY;
CREATE POLICY case_transition_tenant ON sf_application_case.case_transition TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_application_case.case_transition OWNER TO sf_migrator;

-- sf:isolation sf_application_case.idempotency_record TENANT_SCOPED owner=CMP-015
CREATE TABLE sf_application_case.idempotency_record (
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
ALTER TABLE sf_application_case.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_application_case.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_tenant ON sf_application_case.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_application_case.idempotency_record OWNER TO sf_migrator;

-- Frozen SF-CON-APPLICATION-CASE-SM transition table, enforced again at the database so no
-- caller (including a misconfigured workflow worker) can commit an illegal case state.
CREATE FUNCTION sf_application_case.enforce_case_transition() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  legal constant text[] := ARRAY[
    'DRAFT>READY_TO_SUBMIT', 'READY_TO_SUBMIT>SUBMITTED', 'READY_TO_SUBMIT>DRAFT',
    'SUBMITTED>PAYMENT_PENDING', 'SUBMITTED>RECEIVED', 'PAYMENT_PENDING>RECEIVED',
    'RECEIVED>UNDER_SCRUTINY', 'UNDER_SCRUTINY>DEFICIENCY_RAISED', 'UNDER_SCRUTINY>VERIFICATION',
    'UNDER_SCRUTINY>DECISION_PENDING', 'DEFICIENCY_RAISED>CITIZEN_RESPONSE',
    'CITIZEN_RESPONSE>UNDER_SCRUTINY', 'VERIFICATION>UNDER_SCRUTINY', 'VERIFICATION>DECISION_PENDING',
    'DECISION_PENDING>APPROVED', 'DECISION_PENDING>REJECTED', 'APPROVED>SIGNING_PENDING',
    'APPROVED>ISSUED', 'REJECTED>CLOSED', 'SIGNING_PENDING>ISSUED', 'ISSUED>CLOSED',
    'DRAFT>WITHDRAWN', 'READY_TO_SUBMIT>WITHDRAWN', 'SUBMITTED>WITHDRAWN', 'PAYMENT_PENDING>WITHDRAWN',
    'RECEIVED>WITHDRAWN', 'UNDER_SCRUTINY>WITHDRAWN', 'DEFICIENCY_RAISED>WITHDRAWN',
    'CITIZEN_RESPONSE>WITHDRAWN', 'VERIFICATION>WITHDRAWN', 'DECISION_PENDING>WITHDRAWN',
    'PAYMENT_PENDING>CANCELLED', 'DEFICIENCY_RAISED>CANCELLED', 'SUBMITTED>CANCELLED',
    'RECEIVED>CANCELLED', 'UNDER_SCRUTINY>CANCELLED', 'CITIZEN_RESPONSE>CANCELLED',
    'VERIFICATION>CANCELLED', 'DECISION_PENDING>CANCELLED'
  ];
  request_kind text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'application cases are never deleted'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'DRAFT' OR NEW.aggregate_version <> 1 THEN
      RAISE EXCEPTION 'a case is created only as DRAFT at aggregate_version 1'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_service_binding_id, NEW.form_version_id, NEW.rule_version_id, NEW.workflow_version_id,
      NEW.evidence_policy_version_id, NEW.sla_policy_version_id, NEW.fee_policy_version_id,
      NEW.credential_template_version_id, NEW.notification_version_id,
      NEW.authorization_policy_version_id, NEW.pin_graph_hash)
     IS DISTINCT FROM
     (OLD.tenant_service_binding_id, OLD.form_version_id, OLD.rule_version_id, OLD.workflow_version_id,
      OLD.evidence_policy_version_id, OLD.sla_policy_version_id, OLD.fee_policy_version_id,
      OLD.credential_template_version_id, OLD.notification_version_id,
      OLD.authorization_policy_version_id, OLD.pin_graph_hash) THEN
    RAISE EXCEPTION 'pinned versions are immutable; repoint only through a governed migration'
      USING ERRCODE = 'P0001', HINT = 'SF_PIN_IMMUTABLE';
  END IF;
  IF (NEW.application_id, NEW.tenant_id, NEW.cell_id, NEW.service_id, NEW.applicant_id,
      NEW.organisation_id, NEW.jurisdiction_id, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.application_id, OLD.tenant_id, OLD.cell_id, OLD.service_id, OLD.applicant_id,
      OLD.organisation_id, OLD.jurisdiction_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'case identity columns are immutable'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  IF NEW.aggregate_version <> OLD.aggregate_version + 1 THEN
    RAISE EXCEPTION 'aggregate_version must advance by exactly one'
      USING ERRCODE = 'P0001', HINT = 'SF_STALE_VERSION';
  END IF;
  IF NOT ((OLD.state || '>' || NEW.state) = ANY (legal)) THEN
    RAISE EXCEPTION 'illegal case transition'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  IF NEW.state IN ('WITHDRAWN', 'CANCELLED') THEN
    request_kind := CASE WHEN NEW.state = 'WITHDRAWN' THEN 'WITHDRAWAL' ELSE 'CANCELLATION' END;
    IF NOT EXISTS (
      SELECT 1 FROM sf_application_case.case_request_reference r
       WHERE r.tenant_id = NEW.tenant_id
         AND r.application_id = NEW.application_id
         AND r.kind = request_kind
         AND r.status = 'COMMITTED'
         AND r.consumed_at_version = NEW.aggregate_version
    ) THEN
      RAISE EXCEPTION 'WITHDRAWN/CANCELLED requires a committed request construct'
        USING ERRCODE = 'P0001', HINT = 'SF_REQUEST_NOT_COMMITTED';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_application_case.enforce_case_transition() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_application_case.enforce_case_transition() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_application_case.enforce_case_transition() TO sf_cmp015_rw;

CREATE TRIGGER application_case_transition_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_application_case.application_case
  FOR EACH ROW
  EXECUTE FUNCTION sf_application_case.enforce_case_transition();

CREATE FUNCTION sf_application_case.enforce_request_reference() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'request references are never deleted'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'SUBMITTED' OR NEW.consumed_at_version IS NOT NULL THEN
      RAISE EXCEPTION 'a request reference starts as SUBMITTED and unconsumed'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.request_id, NEW.tenant_id, NEW.application_id, NEW.kind, NEW.case_state_at_request,
      NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.request_id, OLD.tenant_id, OLD.application_id, OLD.kind, OLD.case_state_at_request,
      OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'request reference identity columns are immutable'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  IF NEW.status = OLD.status THEN
    IF NEW.status = 'COMMITTED' AND OLD.consumed_at_version IS NULL
       AND NEW.consumed_at_version IS NOT NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'request reference unchanged or already consumed'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  IF NEW.consumed_at_version IS NOT NULL THEN
    RAISE EXCEPTION 'a request is consumed only after it is COMMITTED'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  IF NOT (
    (OLD.status = 'SUBMITTED' AND NEW.status IN ('UNDER_REVIEW', 'REJECTED', 'EXPIRED', 'COMMITTED'))
    OR (OLD.status = 'UNDER_REVIEW' AND NEW.status IN ('REJECTED', 'EXPIRED', 'COMMITTED'))
  ) THEN
    RAISE EXCEPTION 'illegal request reference status change'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_application_case.enforce_request_reference() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_application_case.enforce_request_reference() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_application_case.enforce_request_reference() TO sf_cmp015_rw;

CREATE TRIGGER case_request_reference_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_application_case.case_request_reference
  FOR EACH ROW
  EXECUTE FUNCTION sf_application_case.enforce_request_reference();

CREATE FUNCTION sf_application_case.prevent_transition_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'case transitions are append-only'
    USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
END
$$;
ALTER FUNCTION sf_application_case.prevent_transition_mutation() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_application_case.prevent_transition_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_application_case.prevent_transition_mutation() TO sf_cmp015_rw;

CREATE TRIGGER case_transition_immutable
  BEFORE UPDATE OR DELETE ON sf_application_case.case_transition
  FOR EACH ROW
  EXECUTE FUNCTION sf_application_case.prevent_transition_mutation();

GRANT SELECT, INSERT ON sf_application_case.application_case TO sf_cmp015_rw;
GRANT UPDATE (state, aggregate_version, updated_at, submitted_at, last_correlation_id)
  ON sf_application_case.application_case TO sf_cmp015_rw;
GRANT SELECT, INSERT ON sf_application_case.case_request_reference TO sf_cmp015_rw;
GRANT UPDATE (status, status_reason_code, consumed_at_version, updated_at, last_correlation_id)
  ON sf_application_case.case_request_reference TO sf_cmp015_rw;
GRANT SELECT, INSERT ON sf_application_case.case_transition TO sf_cmp015_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (
  status, response_ref, response_status, response_body
) ON sf_application_case.idempotency_record TO sf_cmp015_rw;

REVOKE ALL ON sf_application_case.application_case FROM PUBLIC;
REVOKE ALL ON sf_application_case.case_request_reference FROM PUBLIC;
REVOKE ALL ON sf_application_case.case_transition FROM PUBLIC;
REVOKE ALL ON sf_application_case.idempotency_record FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS case_transition_immutable ON sf_application_case.case_transition;
DROP TRIGGER IF EXISTS case_request_reference_guard ON sf_application_case.case_request_reference;
DROP TRIGGER IF EXISTS application_case_transition_guard ON sf_application_case.application_case;
DROP FUNCTION IF EXISTS sf_application_case.prevent_transition_mutation();
DROP FUNCTION IF EXISTS sf_application_case.enforce_request_reference();
DROP FUNCTION IF EXISTS sf_application_case.enforce_case_transition();
DROP TABLE IF EXISTS sf_application_case.idempotency_record;
DROP TABLE IF EXISTS sf_application_case.case_transition;
DROP TABLE IF EXISTS sf_application_case.case_request_reference;
DROP TABLE IF EXISTS sf_application_case.application_case;
DROP SCHEMA IF EXISTS sf_application_case;
-- Role sf_cmp015_rw retained (may be referenced by runtime logins); never DROP ROLE here.
