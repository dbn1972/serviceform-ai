-- CMP-060 Risk, Fraud & Integrity Service (SF-M09-005).
-- Architecture Constitution rule 40: Risk/fraud/integrity signals are advisory by default.
-- No adverse statutory outcome may rely solely on an opaque AI/ML score.
-- SF-CON-RISK-ASSESSMENT FROZEN: authoritative_decision_by_this_component MUST always be false.
-- INT-018: Risk/integrity signal to authorized review.
-- INT-011: Tenant isolation enforcement chain.
-- This schema records non-authoritative advisory risk assessments only; downstream decisions
-- require deterministic policy (GoRules) or authorized human review.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp060_rw') THEN
    CREATE ROLE sf_cmp060_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp060_rw IS
  'ADR-0006: CMP-060 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_risk AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_risk IS
  'isolation_class=TENANT_SCOPED; owner=CMP-060; advisory risk/integrity signals only; no authoritative decisions';

REVOKE ALL ON SCHEMA sf_risk FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_risk TO sf_cmp060_rw;
GRANT USAGE ON SCHEMA sf_risk TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_risk REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_risk REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_risk REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_risk.risk_assessment TENANT_SCOPED owner=CMP-060
-- Stores the advisory, non-authoritative risk/integrity assessment record.
-- The CHECK constraint on authoritative_decision_by_this_component is a hard database-level gate
-- enforcing Architecture Constitution rule 40 and SF-CON-RISK-ASSESSMENT FROZEN.
CREATE TABLE sf_risk.risk_assessment (
  tenant_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  subject_application_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  correlation_id uuid,
  -- FROZEN constraint: this component MUST NOT make authoritative decisions (Architecture Constitution #40)
  authoritative_decision_by_this_component boolean NOT NULL DEFAULT false
    CHECK (authoritative_decision_by_this_component = false),
  -- FROZEN constraint: statutory policy invention is forbidden
  invented_statutory_policy_forbidden boolean NOT NULL DEFAULT true
    CHECK (invented_statutory_policy_forbidden = true),
  lifecycle_status text NOT NULL
    CHECK (lifecycle_status IN ('COMPLETED', 'HIGH_RISK_REVIEW_REQUESTED', 'DISPOSITION_RECORDED')),
  -- Raw score is stored for audit/explainability but MUST NOT directly determine adverse outcomes
  raw_risk_score numeric CHECK (raw_risk_score IS NULL OR (raw_risk_score >= 0 AND raw_risk_score <= 1)),
  -- risk_tier is an advisory classification derived by deterministic rule (GoRules), not raw score alone
  risk_tier text CHECK (risk_tier IS NULL OR risk_tier IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  signal_count integer NOT NULL DEFAULT 0 CHECK (signal_count >= 0),
  review_requested_at timestamptz,
  disposition_recorded_at timestamptz,
  actor_type text NOT NULL CHECK (actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  requested_by uuid NOT NULL,
  model_or_rule_version text CHECK (model_or_rule_version IS NULL OR char_length(model_or_rule_version) <= 64),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, assessment_id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (
    (lifecycle_status = 'HIGH_RISK_REVIEW_REQUESTED') = (review_requested_at IS NOT NULL)
    OR lifecycle_status = 'DISPOSITION_RECORDED'
  ),
  CHECK (
    (lifecycle_status = 'DISPOSITION_RECORDED') = (disposition_recorded_at IS NOT NULL)
  )
);
CREATE INDEX risk_assessment_application_idx ON sf_risk.risk_assessment (tenant_id, subject_application_id, recorded_at);
ALTER TABLE sf_risk.risk_assessment ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_risk.risk_assessment FORCE ROW LEVEL SECURITY;
CREATE POLICY risk_assessment_isolation ON sf_risk.risk_assessment TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_risk.risk_assessment OWNER TO sf_migrator;

-- sf:isolation sf_risk.risk_signal TENANT_SCOPED owner=CMP-060
-- Each individual advisory signal attached to an assessment.
-- Signals are advisory evidence items, never binding determinants.
CREATE TABLE sf_risk.risk_signal (
  tenant_id uuid NOT NULL,
  signal_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  signal_code text NOT NULL CHECK (char_length(signal_code) BETWEEN 1 AND 64),
  provenance_ref text NOT NULL CHECK (char_length(provenance_ref) BETWEEN 1 AND 128),
  model_or_rule_version text CHECK (model_or_rule_version IS NULL OR char_length(model_or_rule_version) <= 64),
  detail jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, signal_id),
  FOREIGN KEY (tenant_id, assessment_id) REFERENCES sf_risk.risk_assessment (tenant_id, assessment_id)
);
CREATE INDEX risk_signal_assessment_idx ON sf_risk.risk_signal (tenant_id, assessment_id);
ALTER TABLE sf_risk.risk_signal ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_risk.risk_signal FORCE ROW LEVEL SECURITY;
CREATE POLICY risk_signal_isolation ON sf_risk.risk_signal TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_risk.risk_signal OWNER TO sf_migrator;

-- sf:isolation sf_risk.review_disposition TENANT_SCOPED owner=CMP-060
-- Records the outcome of an authorized human review (INT-018).
-- Disposition is always made by an authorized human, never by AI alone.
CREATE TABLE sf_risk.review_disposition (
  tenant_id uuid NOT NULL,
  disposition_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('CLEARED', 'ESCALATED', 'REFERRED_ENFORCEMENT')),
  disposition_note text CHECK (disposition_note IS NULL OR char_length(disposition_note) <= 2000),
  disposed_by uuid NOT NULL,
  disposed_at timestamptz NOT NULL,
  correlation_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, disposition_id),
  UNIQUE (tenant_id, assessment_id),
  FOREIGN KEY (tenant_id, assessment_id) REFERENCES sf_risk.risk_assessment (tenant_id, assessment_id)
);
ALTER TABLE sf_risk.review_disposition ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_risk.review_disposition FORCE ROW LEVEL SECURITY;
CREATE POLICY review_disposition_isolation ON sf_risk.review_disposition TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_risk.review_disposition OWNER TO sf_migrator;

-- sf:isolation sf_risk.idempotency_record TENANT_SCOPED owner=CMP-060
CREATE TABLE sf_risk.idempotency_record (
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
ALTER TABLE sf_risk.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_risk.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_risk.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_risk.idempotency_record OWNER TO sf_migrator;

-- sf:isolation sf_risk.outbox_event TENANT_SCOPED owner=CMP-060
-- Outbox for domain events (transactional outbox pattern, INT-011).
CREATE TABLE sf_risk.outbox_event (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  topic text NOT NULL,
  partition_key text NOT NULL,
  event_type text NOT NULL,
  schema_version integer NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version integer NOT NULL,
  envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz
);
ALTER TABLE sf_risk.outbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_risk.outbox_event FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_event_isolation ON sf_risk.outbox_event TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_risk.outbox_event OWNER TO sf_migrator;

-- Append-only: assessments and signals are never deleted or updated (provenance integrity).
CREATE FUNCTION sf_risk.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_risk, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'risk provenance is append-only' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_risk.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER risk_assessment_no_delete
  BEFORE DELETE ON sf_risk.risk_assessment
  FOR EACH ROW EXECUTE FUNCTION sf_risk.reject_mutation();
CREATE TRIGGER risk_signal_immutable
  BEFORE UPDATE OR DELETE ON sf_risk.risk_signal
  FOR EACH ROW EXECUTE FUNCTION sf_risk.reject_mutation();
CREATE TRIGGER review_disposition_immutable
  BEFORE UPDATE OR DELETE ON sf_risk.review_disposition
  FOR EACH ROW EXECUTE FUNCTION sf_risk.reject_mutation();

-- Forward-only lifecycle guard for risk_assessment.
-- Transitions: COMPLETED -> HIGH_RISK_REVIEW_REQUESTED -> DISPOSITION_RECORDED
-- authoritative_decision_by_this_component is immutable after insert (must stay false).
CREATE FUNCTION sf_risk.guard_assessment_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_risk, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_status <> 'COMPLETED' THEN
      RAISE EXCEPTION 'risk assessment must be created COMPLETED' USING ERRCODE = '55000';
    END IF;
    IF NEW.authoritative_decision_by_this_component IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'authoritative_decision_by_this_component must be false (Architecture Constitution #40)'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  -- Immutable provenance columns
  IF (NEW.tenant_id, NEW.assessment_id, NEW.subject_application_id, NEW.cell_id,
      NEW.idempotency_key, NEW.authoritative_decision_by_this_component,
      NEW.invented_statutory_policy_forbidden, NEW.actor_type, NEW.requested_by, NEW.recorded_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.assessment_id, OLD.subject_application_id, OLD.cell_id,
      OLD.idempotency_key, OLD.authoritative_decision_by_this_component,
      OLD.invented_statutory_policy_forbidden, OLD.actor_type, OLD.requested_by, OLD.recorded_at) THEN
    RAISE EXCEPTION 'risk assessment provenance is immutable' USING ERRCODE = '42501';
  END IF;
  -- Forward-only transitions
  IF OLD.lifecycle_status = 'COMPLETED' AND NEW.lifecycle_status = 'HIGH_RISK_REVIEW_REQUESTED' THEN
    RETURN NEW;
  END IF;
  IF OLD.lifecycle_status = 'HIGH_RISK_REVIEW_REQUESTED' AND NEW.lifecycle_status = 'DISPOSITION_RECORDED' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'risk assessment lifecycle is forward-only (% -> %)',
    OLD.lifecycle_status, NEW.lifecycle_status USING ERRCODE = '55000';
END;
$$;
ALTER FUNCTION sf_risk.guard_assessment_transition() OWNER TO sf_migrator;

CREATE TRIGGER risk_assessment_transition_guard
  BEFORE INSERT OR UPDATE ON sf_risk.risk_assessment
  FOR EACH ROW EXECUTE FUNCTION sf_risk.guard_assessment_transition();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_risk FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_risk FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_risk FROM PUBLIC;

GRANT SELECT, INSERT ON sf_risk.risk_assessment TO sf_cmp060_rw;
GRANT UPDATE (lifecycle_status, review_requested_at, disposition_recorded_at, risk_tier, raw_risk_score)
  ON sf_risk.risk_assessment TO sf_cmp060_rw;
GRANT SELECT, INSERT ON sf_risk.risk_signal TO sf_cmp060_rw;
GRANT SELECT, INSERT ON sf_risk.review_disposition TO sf_cmp060_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_risk.idempotency_record TO sf_cmp060_rw;
GRANT SELECT, INSERT, UPDATE (dispatched_at) ON sf_risk.outbox_event TO sf_cmp060_rw;

GRANT EXECUTE ON FUNCTION sf_risk.reject_mutation() TO sf_cmp060_rw;
GRANT EXECUTE ON FUNCTION sf_risk.guard_assessment_transition() TO sf_cmp060_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_risk FROM sf_cmp060_rw;
REVOKE ALL ON SCHEMA sf_risk FROM sf_app;
DROP SCHEMA IF EXISTS sf_risk CASCADE;
-- Role sf_cmp060_rw retained (may be referenced by runtime logins); never DROP ROLE here.
