-- CMP-019 Deficiency / Clarification (SF-M05-006). ADR-0006 Option A: sf_cmp019_rw NOLOGIN
-- holds DML; FORCE RLS; PUBLIC revoked; runtime is not the table owner (sf_migrator).
-- CMP-019 owns deficiency notices, requested items, citizen responses and evidence refs only.
-- Case state changes go through the CMP-015 command port; SLA pause/resume through the CMP-029
-- INT-009 port. This migration grants no privilege on peer component schemas.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp019_rw') THEN
    CREATE ROLE sf_cmp019_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp019_rw IS
  'ADR-0006: CMP-019 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_deficiency AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_deficiency IS
  'isolation_class=TENANT_SCOPED; owner=CMP-019; deficiency notices, items, responses, evidence refs';

REVOKE ALL ON SCHEMA sf_deficiency FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_deficiency TO sf_cmp019_rw;
GRANT USAGE ON SCHEMA sf_deficiency TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_deficiency REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_deficiency REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_deficiency REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_deficiency.deficiency_notice TENANT_SCOPED owner=CMP-019
CREATE TABLE sf_deficiency.deficiency_notice (
  tenant_id uuid NOT NULL,
  deficiency_id uuid NOT NULL,
  application_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  status text NOT NULL CHECK (status IN ('OPEN', 'RESPONSE_RECEIVED', 'CLOSED')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  notice_code text NOT NULL CHECK (notice_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  instruction_ref text NOT NULL CHECK (char_length(instruction_ref) BETWEEN 1 AND 200),
  sla_pause_reason_code text NOT NULL DEFAULT 'DEFICIENCY_OPEN'
    CHECK (sla_pause_reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  sla_stage_code text NOT NULL DEFAULT 'OVERALL'
    CHECK (sla_stage_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  response_due_at timestamptz,
  opened_at timestamptz NOT NULL,
  responded_at timestamptz,
  closed_at timestamptz,
  close_reason_code text CHECK (close_reason_code IS NULL OR close_reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  opened_by uuid NOT NULL,
  closed_by uuid,
  correlation_id uuid NOT NULL,
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, deficiency_id),
  CHECK (status <> 'OPEN' OR (responded_at IS NULL AND closed_at IS NULL AND closed_by IS NULL AND close_reason_code IS NULL)),
  CHECK (status <> 'RESPONSE_RECEIVED' OR (responded_at IS NOT NULL AND closed_at IS NULL)),
  CHECK (status <> 'CLOSED' OR (closed_at IS NOT NULL AND closed_by IS NOT NULL AND close_reason_code IS NOT NULL)),
  CHECK (response_due_at IS NULL OR response_due_at > opened_at)
);
CREATE UNIQUE INDEX deficiency_notice_active_application_uidx
  ON sf_deficiency.deficiency_notice (tenant_id, application_id)
  WHERE status IN ('OPEN', 'RESPONSE_RECEIVED');
CREATE INDEX deficiency_notice_application_idx
  ON sf_deficiency.deficiency_notice (tenant_id, application_id);
ALTER TABLE sf_deficiency.deficiency_notice ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_deficiency.deficiency_notice FORCE ROW LEVEL SECURITY;
CREATE POLICY deficiency_notice_isolation ON sf_deficiency.deficiency_notice TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_deficiency.deficiency_notice OWNER TO sf_migrator;

-- sf:isolation sf_deficiency.requested_item TENANT_SCOPED owner=CMP-019
CREATE TABLE sf_deficiency.requested_item (
  tenant_id uuid NOT NULL,
  deficiency_id uuid NOT NULL,
  item_seq smallint NOT NULL CHECK (item_seq >= 1),
  item_code text NOT NULL CHECK (item_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  evidence_requirement_ref uuid,
  required boolean NOT NULL DEFAULT true,
  item_status text NOT NULL CHECK (item_status IN ('REQUESTED', 'PROVIDED')),
  PRIMARY KEY (tenant_id, deficiency_id, item_seq),
  UNIQUE (tenant_id, deficiency_id, item_code),
  FOREIGN KEY (tenant_id, deficiency_id)
    REFERENCES sf_deficiency.deficiency_notice (tenant_id, deficiency_id)
);
ALTER TABLE sf_deficiency.requested_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_deficiency.requested_item FORCE ROW LEVEL SECURITY;
CREATE POLICY requested_item_isolation ON sf_deficiency.requested_item TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_deficiency.requested_item OWNER TO sf_migrator;

-- sf:isolation sf_deficiency.citizen_response TENANT_SCOPED owner=CMP-019
CREATE TABLE sf_deficiency.citizen_response (
  tenant_id uuid NOT NULL,
  response_id uuid NOT NULL,
  deficiency_id uuid NOT NULL,
  narrative_ref text NOT NULL CHECK (char_length(narrative_ref) BETWEEN 1 AND 200),
  responded_at timestamptz NOT NULL,
  actor_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, response_id),
  UNIQUE (tenant_id, deficiency_id),
  FOREIGN KEY (tenant_id, deficiency_id)
    REFERENCES sf_deficiency.deficiency_notice (tenant_id, deficiency_id)
);
ALTER TABLE sf_deficiency.citizen_response ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_deficiency.citizen_response FORCE ROW LEVEL SECURITY;
CREATE POLICY citizen_response_isolation ON sf_deficiency.citizen_response TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_deficiency.citizen_response OWNER TO sf_migrator;

-- sf:isolation sf_deficiency.evidence_ref TENANT_SCOPED owner=CMP-019
CREATE TABLE sf_deficiency.evidence_ref (
  tenant_id uuid NOT NULL,
  link_id uuid NOT NULL,
  deficiency_id uuid NOT NULL,
  response_id uuid,
  evidence_ref uuid NOT NULL,
  kind_code text NOT NULL CHECK (kind_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  attached_by uuid NOT NULL,
  attached_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, link_id),
  FOREIGN KEY (tenant_id, deficiency_id)
    REFERENCES sf_deficiency.deficiency_notice (tenant_id, deficiency_id),
  FOREIGN KEY (tenant_id, response_id)
    REFERENCES sf_deficiency.citizen_response (tenant_id, response_id)
);
CREATE INDEX evidence_ref_deficiency_idx
  ON sf_deficiency.evidence_ref (tenant_id, deficiency_id);
ALTER TABLE sf_deficiency.evidence_ref ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_deficiency.evidence_ref FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_ref_isolation ON sf_deficiency.evidence_ref TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_deficiency.evidence_ref OWNER TO sf_migrator;

-- sf:isolation sf_deficiency.deficiency_event TENANT_SCOPED owner=CMP-019
CREATE TABLE sf_deficiency.deficiency_event (
  tenant_id uuid NOT NULL,
  deficiency_id uuid NOT NULL,
  sequence_no bigint NOT NULL CHECK (sequence_no >= 1),
  operation text NOT NULL CHECK (operation IN ('OPEN', 'RESPOND', 'CLOSE')),
  from_status text CHECK (from_status IS NULL OR from_status IN ('OPEN', 'RESPONSE_RECEIVED', 'CLOSED')),
  to_status text NOT NULL CHECK (to_status IN ('OPEN', 'RESPONSE_RECEIVED', 'CLOSED')),
  occurred_at timestamptz NOT NULL,
  reason_code text CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  actor_type text NOT NULL CHECK (actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  actor_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, deficiency_id, sequence_no),
  FOREIGN KEY (tenant_id, deficiency_id)
    REFERENCES sf_deficiency.deficiency_notice (tenant_id, deficiency_id)
);
ALTER TABLE sf_deficiency.deficiency_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_deficiency.deficiency_event FORCE ROW LEVEL SECURITY;
CREATE POLICY deficiency_event_isolation ON sf_deficiency.deficiency_event TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_deficiency.deficiency_event OWNER TO sf_migrator;

-- sf:isolation sf_deficiency.idempotency_record TENANT_SCOPED owner=CMP-019
CREATE TABLE sf_deficiency.idempotency_record (
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
ALTER TABLE sf_deficiency.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_deficiency.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_deficiency.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_deficiency.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_deficiency.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_deficiency, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'insert-only deficiency row' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_deficiency.reject_mutation() OWNER TO sf_migrator;

CREATE FUNCTION sf_deficiency.guard_item_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_deficiency, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'requested items are retained' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'item_status') IS DISTINCT FROM (to_jsonb(OLD) - 'item_status') THEN
      RAISE EXCEPTION 'requested item identity is immutable' USING ERRCODE = '42501';
    END IF;
    IF NOT (OLD.item_status = 'REQUESTED' AND NEW.item_status = 'PROVIDED') THEN
      RAISE EXCEPTION 'requested item status % -> % refused', OLD.item_status, NEW.item_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_deficiency.guard_item_status() OWNER TO sf_migrator;

CREATE TRIGGER requested_item_guard
  BEFORE UPDATE OR DELETE ON sf_deficiency.requested_item
  FOR EACH ROW EXECUTE FUNCTION sf_deficiency.guard_item_status();

CREATE TRIGGER citizen_response_immutable
  BEFORE UPDATE OR DELETE ON sf_deficiency.citizen_response
  FOR EACH ROW EXECUTE FUNCTION sf_deficiency.reject_mutation();

CREATE TRIGGER evidence_ref_immutable
  BEFORE UPDATE OR DELETE ON sf_deficiency.evidence_ref
  FOR EACH ROW EXECUTE FUNCTION sf_deficiency.reject_mutation();

CREATE TRIGGER deficiency_event_immutable
  BEFORE UPDATE OR DELETE ON sf_deficiency.deficiency_event
  FOR EACH ROW EXECUTE FUNCTION sf_deficiency.reject_mutation();

CREATE FUNCTION sf_deficiency.guard_notice_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_deficiency, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'deficiency notices are retained' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' THEN
      RAISE EXCEPTION 'deficiency notice must start OPEN';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'closed deficiency notice is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.deficiency_id IS DISTINCT FROM OLD.deficiency_id
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.cell_id IS DISTINCT FROM OLD.cell_id
     OR NEW.reason_code IS DISTINCT FROM OLD.reason_code
     OR NEW.notice_code IS DISTINCT FROM OLD.notice_code
     OR NEW.instruction_ref IS DISTINCT FROM OLD.instruction_ref
     OR NEW.sla_pause_reason_code IS DISTINCT FROM OLD.sla_pause_reason_code
     OR NEW.sla_stage_code IS DISTINCT FROM OLD.sla_stage_code
     OR NEW.response_due_at IS DISTINCT FROM OLD.response_due_at
     OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
     OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id THEN
    RAISE EXCEPTION 'deficiency notice identity and notice metadata are immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.aggregate_version <> OLD.aggregate_version + 1 THEN
    RAISE EXCEPTION 'deficiency aggregate_version must advance by one';
  END IF;
  IF NOT (
       (OLD.status = 'OPEN' AND NEW.status IN ('RESPONSE_RECEIVED', 'CLOSED'))
    OR (OLD.status = 'RESPONSE_RECEIVED' AND NEW.status = 'CLOSED')
  ) THEN
    RAISE EXCEPTION 'deficiency transition % -> % refused', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_deficiency.guard_notice_transition() OWNER TO sf_migrator;

CREATE TRIGGER deficiency_notice_transition_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_deficiency.deficiency_notice
  FOR EACH ROW EXECUTE FUNCTION sf_deficiency.guard_notice_transition();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_deficiency FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_deficiency FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_deficiency FROM PUBLIC;

GRANT SELECT, INSERT,
  UPDATE (
    status, responded_at, closed_at, close_reason_code, closed_by,
    aggregate_version, updated_at
  )
  ON sf_deficiency.deficiency_notice TO sf_cmp019_rw;
GRANT SELECT, INSERT, UPDATE (item_status) ON sf_deficiency.requested_item TO sf_cmp019_rw;
GRANT SELECT, INSERT ON sf_deficiency.citizen_response TO sf_cmp019_rw;
GRANT SELECT, INSERT ON sf_deficiency.evidence_ref TO sf_cmp019_rw;
GRANT SELECT, INSERT ON sf_deficiency.deficiency_event TO sf_cmp019_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_deficiency.idempotency_record TO sf_cmp019_rw;

GRANT EXECUTE ON FUNCTION sf_deficiency.reject_mutation() TO sf_cmp019_rw;
GRANT EXECUTE ON FUNCTION sf_deficiency.guard_item_status() TO sf_cmp019_rw;
GRANT EXECUTE ON FUNCTION sf_deficiency.guard_notice_transition() TO sf_cmp019_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_deficiency FROM sf_cmp019_rw;
REVOKE ALL ON SCHEMA sf_deficiency FROM sf_app;
DROP SCHEMA IF EXISTS sf_deficiency CASCADE;
-- Role sf_cmp019_rw retained (may be referenced by runtime logins); never DROP ROLE here.
