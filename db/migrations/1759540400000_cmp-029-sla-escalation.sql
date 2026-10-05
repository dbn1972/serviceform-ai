-- CMP-029 SLA & Escalation Engine (SF-M05-004). ADR-0006 Option A: sf_cmp029_rw NOLOGIN
-- holds DML; FORCE RLS; PUBLIC revoked; runtime is not the table owner (sf_migrator).
-- Calendars and published SLA policies are insert-only (retire is the only policy update).
-- Clock deadlines change only on a PAUSED -> RUNNING resume; every transition appends an
-- insert-only history row so the clock can be replayed deterministically. CMP-029 owns SLA
-- state only: it holds no reference to, and no privilege on, any case/application table.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp029_rw') THEN
    CREATE ROLE sf_cmp029_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp029_rw IS
  'ADR-0006: CMP-029 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_sla AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_sla IS
  'isolation_class=TENANT_SCOPED; owner=CMP-029; SLA calendars, published policies, clocks and clock history';

REVOKE ALL ON SCHEMA sf_sla FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_sla TO sf_cmp029_rw;
GRANT USAGE ON SCHEMA sf_sla TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_sla REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_sla REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_sla REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_sla.sla_calendar TENANT_SCOPED owner=CMP-029
CREATE TABLE sf_sla.sla_calendar (
  tenant_id uuid NOT NULL,
  calendar_id uuid NOT NULL,
  calendar_code text NOT NULL CHECK (calendar_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  version_no bigint NOT NULL CHECK (version_no >= 1),
  utc_offset_minutes smallint NOT NULL CHECK (utc_offset_minutes BETWEEN -720 AND 840),
  working_weekdays smallint[] NOT NULL
    CHECK (cardinality(working_weekdays) BETWEEN 1 AND 7 AND working_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  window_start_minute smallint NOT NULL CHECK (window_start_minute BETWEEN 0 AND 1439),
  window_end_minute smallint NOT NULL CHECK (window_end_minute BETWEEN 1 AND 1440),
  holidays date[] NOT NULL DEFAULT ARRAY[]::date[] CHECK (cardinality(holidays) <= 3660),
  effective_from timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, calendar_id),
  UNIQUE (tenant_id, calendar_code, version_no),
  CHECK (window_start_minute < window_end_minute)
);
ALTER TABLE sf_sla.sla_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_sla.sla_calendar FORCE ROW LEVEL SECURITY;
CREATE POLICY sla_calendar_isolation ON sf_sla.sla_calendar TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_sla.sla_calendar OWNER TO sf_migrator;

-- sf:isolation sf_sla.sla_policy TENANT_SCOPED owner=CMP-029
CREATE TABLE sf_sla.sla_policy (
  tenant_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  policy_code text NOT NULL CHECK (policy_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  version_no bigint NOT NULL CHECK (version_no >= 1),
  status text NOT NULL CHECK (status IN ('PUBLISHED', 'RETIRED')),
  publication_ref text NOT NULL CHECK (char_length(publication_ref) BETWEEN 3 AND 200),
  start_anchor text NOT NULL CHECK (start_anchor IN (
    'APPLICATION_RECEIVED', 'PAYMENT_CONFIRMED', 'SCRUTINY_STARTED', 'DEFICIENCY_CLOSED',
    'PUBLISHED_POLICY_ANCHOR'
  )),
  completion_anchor text NOT NULL CHECK (completion_anchor IN (
    'DECISION_RECORDED', 'CREDENTIAL_ISSUED', 'CASE_CLOSED', 'PUBLISHED_POLICY_ANCHOR'
  )),
  calendar_id uuid NOT NULL,
  duration_basis text NOT NULL CHECK (duration_basis IN ('WORKING_MINUTES', 'CALENDAR_MINUTES')),
  duration_minutes bigint NOT NULL CHECK (duration_minutes BETWEEN 1 AND 2000000),
  warning_before_minutes bigint CHECK (warning_before_minutes IS NULL OR warning_before_minutes BETWEEN 1 AND 2000000),
  allowed_pause_reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[]
    CHECK (cardinality(allowed_pause_reason_codes) <= 32),
  escalation_schedule jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(escalation_schedule) = 'array'
    AND jsonb_array_length(escalation_schedule) <= 10
    AND octet_length(escalation_schedule::text) <= 4096
  ),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  PRIMARY KEY (tenant_id, policy_id),
  UNIQUE (tenant_id, policy_code, version_no),
  FOREIGN KEY (tenant_id, calendar_id) REFERENCES sf_sla.sla_calendar (tenant_id, calendar_id),
  CHECK ((status = 'RETIRED') = (retired_at IS NOT NULL))
);
ALTER TABLE sf_sla.sla_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_sla.sla_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY sla_policy_isolation ON sf_sla.sla_policy TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_sla.sla_policy OWNER TO sf_migrator;

-- sf:isolation sf_sla.sla_clock TENANT_SCOPED owner=CMP-029
CREATE TABLE sf_sla.sla_clock (
  tenant_id uuid NOT NULL,
  clock_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  application_id uuid NOT NULL,
  stage_code text NOT NULL CHECK (stage_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  policy_id uuid NOT NULL,
  calendar_id uuid NOT NULL,
  start_anchor text NOT NULL CHECK (start_anchor IN (
    'APPLICATION_RECEIVED', 'PAYMENT_CONFIRMED', 'SCRUTINY_STARTED', 'DEFICIENCY_CLOSED',
    'PUBLISHED_POLICY_ANCHOR'
  )),
  completion_anchor text NOT NULL CHECK (completion_anchor IN (
    'DECISION_RECORDED', 'CREDENTIAL_ISSUED', 'CASE_CLOSED', 'PUBLISHED_POLICY_ANCHOR'
  )),
  anchor_event_ref uuid,
  status text NOT NULL CHECK (status IN ('NOT_STARTED', 'RUNNING', 'PAUSED', 'COMPLETED', 'BREACHED')),
  started_at timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL,
  server_computed_deadline boolean NOT NULL DEFAULT true CHECK (server_computed_deadline),
  remaining_ms bigint CHECK (remaining_ms IS NULL OR remaining_ms >= 0),
  paused_at timestamptz,
  pause_reason_code text CHECK (pause_reason_code IS NULL OR pause_reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  pause_count integer NOT NULL DEFAULT 0 CHECK (pause_count >= 0),
  resumed_at timestamptz,
  completed_at timestamptz,
  breach_at timestamptz,
  warning_emitted_at timestamptz,
  escalation_level smallint NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 10),
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, clock_id),
  UNIQUE (tenant_id, application_id, stage_code),
  FOREIGN KEY (tenant_id, policy_id) REFERENCES sf_sla.sla_policy (tenant_id, policy_id),
  FOREIGN KEY (tenant_id, calendar_id) REFERENCES sf_sla.sla_calendar (tenant_id, calendar_id),
  CHECK (
    (status = 'PAUSED') = (paused_at IS NOT NULL AND pause_reason_code IS NOT NULL AND remaining_ms IS NOT NULL)
  ),
  CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL),
  CHECK (status <> 'BREACHED' OR breach_at IS NOT NULL)
);
CREATE INDEX sla_clock_application_idx ON sf_sla.sla_clock (tenant_id, application_id);
CREATE INDEX sla_clock_due_idx ON sf_sla.sla_clock (tenant_id, deadline_at) WHERE status IN ('RUNNING', 'BREACHED');
ALTER TABLE sf_sla.sla_clock ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_sla.sla_clock FORCE ROW LEVEL SECURITY;
CREATE POLICY sla_clock_isolation ON sf_sla.sla_clock TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_sla.sla_clock OWNER TO sf_migrator;

-- sf:isolation sf_sla.sla_clock_event TENANT_SCOPED owner=CMP-029
CREATE TABLE sf_sla.sla_clock_event (
  tenant_id uuid NOT NULL,
  clock_id uuid NOT NULL,
  sequence_no bigint NOT NULL CHECK (sequence_no >= 1),
  operation text NOT NULL CHECK (operation IN (
    'START', 'PAUSE', 'RESUME', 'COMPLETE', 'WARN', 'BREACH', 'ESCALATE'
  )),
  from_status text CHECK (from_status IS NULL OR from_status IN (
    'NOT_STARTED', 'RUNNING', 'PAUSED', 'COMPLETED', 'BREACHED'
  )),
  to_status text NOT NULL CHECK (to_status IN (
    'NOT_STARTED', 'RUNNING', 'PAUSED', 'COMPLETED', 'BREACHED'
  )),
  occurred_at timestamptz NOT NULL,
  reason_code text CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  deadline_before timestamptz,
  deadline_after timestamptz NOT NULL,
  remaining_ms bigint CHECK (remaining_ms IS NULL OR remaining_ms >= 0),
  escalation_level smallint NOT NULL CHECK (escalation_level BETWEEN 0 AND 10),
  actor_type text NOT NULL CHECK (actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  actor_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, clock_id, sequence_no),
  FOREIGN KEY (tenant_id, clock_id) REFERENCES sf_sla.sla_clock (tenant_id, clock_id)
);
ALTER TABLE sf_sla.sla_clock_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_sla.sla_clock_event FORCE ROW LEVEL SECURITY;
CREATE POLICY sla_clock_event_isolation ON sf_sla.sla_clock_event TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_sla.sla_clock_event OWNER TO sf_migrator;

-- sf:isolation sf_sla.idempotency_record TENANT_SCOPED owner=CMP-029
CREATE TABLE sf_sla.idempotency_record (
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
ALTER TABLE sf_sla.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_sla.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_sla.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_sla.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_sla.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_sla, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'insert-only SLA row' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_sla.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER sla_calendar_immutable
  BEFORE UPDATE OR DELETE ON sf_sla.sla_calendar
  FOR EACH ROW EXECUTE FUNCTION sf_sla.reject_mutation();

CREATE TRIGGER sla_clock_event_immutable
  BEFORE UPDATE OR DELETE ON sf_sla.sla_clock_event
  FOR EACH ROW EXECUTE FUNCTION sf_sla.reject_mutation();

CREATE FUNCTION sf_sla.guard_policy_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_sla, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'published SLA policy versions are retained' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PUBLISHED' THEN
      RAISE EXCEPTION 'SLA policy version must be inserted PUBLISHED';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT (OLD.status = 'PUBLISHED' AND NEW.status = 'RETIRED') THEN
    RAISE EXCEPTION 'published SLA policy version is immutable' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'retired_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'retired_at') THEN
    RAISE EXCEPTION 'published SLA policy content is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_sla.guard_policy_mutation() OWNER TO sf_migrator;

CREATE TRIGGER sla_policy_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_sla.sla_policy
  FOR EACH ROW EXECUTE FUNCTION sf_sla.guard_policy_mutation();

CREATE FUNCTION sf_sla.guard_clock_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_sla, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SLA clocks are retained' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'RUNNING' OR NEW.escalation_level <> 0 OR NEW.pause_count <> 0 THEN
      RAISE EXCEPTION 'SLA clock must start RUNNING at level 0';
    END IF;
    IF NEW.deadline_at <= NEW.started_at THEN
      RAISE EXCEPTION 'SLA deadline must follow the start anchor';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.clock_id IS DISTINCT FROM OLD.clock_id
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.stage_code IS DISTINCT FROM OLD.stage_code
     OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
     OR NEW.calendar_id IS DISTINCT FROM OLD.calendar_id
     OR NEW.start_anchor IS DISTINCT FROM OLD.start_anchor
     OR NEW.completion_anchor IS DISTINCT FROM OLD.completion_anchor
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.cell_id IS DISTINCT FROM OLD.cell_id THEN
    RAISE EXCEPTION 'SLA clock identity, pins and anchors are immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'completed SLA clock is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.aggregate_version <> OLD.aggregate_version + 1 THEN
    RAISE EXCEPTION 'SLA clock aggregate_version must advance by one';
  END IF;
  IF NOT (
       (OLD.status = 'RUNNING' AND NEW.status IN ('RUNNING', 'PAUSED', 'BREACHED', 'COMPLETED'))
    OR (OLD.status = 'PAUSED' AND NEW.status = 'RUNNING')
    OR (OLD.status = 'BREACHED' AND NEW.status IN ('BREACHED', 'COMPLETED'))
  ) THEN
    RAISE EXCEPTION 'SLA clock transition % -> % refused', OLD.status, NEW.status;
  END IF;
  IF NEW.deadline_at IS DISTINCT FROM OLD.deadline_at
     AND NOT (OLD.status = 'PAUSED' AND NEW.status = 'RUNNING') THEN
    RAISE EXCEPTION 'SLA deadline changes only through resume' USING ERRCODE = '42501';
  END IF;
  IF NEW.breach_at IS DISTINCT FROM OLD.breach_at AND OLD.breach_at IS NOT NULL THEN
    RAISE EXCEPTION 'SLA breach timestamp is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.escalation_level < OLD.escalation_level THEN
    RAISE EXCEPTION 'SLA escalation level is monotonic' USING ERRCODE = '42501';
  END IF;
  IF NEW.pause_count < OLD.pause_count THEN
    RAISE EXCEPTION 'SLA pause count is monotonic' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_sla.guard_clock_transition() OWNER TO sf_migrator;

CREATE TRIGGER sla_clock_transition_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_sla.sla_clock
  FOR EACH ROW EXECUTE FUNCTION sf_sla.guard_clock_transition();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_sla FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_sla FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_sla FROM PUBLIC;

GRANT SELECT, INSERT ON sf_sla.sla_calendar TO sf_cmp029_rw;
GRANT SELECT, INSERT, UPDATE (status, retired_at) ON sf_sla.sla_policy TO sf_cmp029_rw;
GRANT SELECT, INSERT,
  UPDATE (
    status, deadline_at, remaining_ms, paused_at, pause_reason_code, pause_count,
    resumed_at, completed_at, breach_at, warning_emitted_at, escalation_level,
    aggregate_version, updated_at
  )
  ON sf_sla.sla_clock TO sf_cmp029_rw;
GRANT SELECT, INSERT ON sf_sla.sla_clock_event TO sf_cmp029_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_sla.idempotency_record TO sf_cmp029_rw;

GRANT EXECUTE ON FUNCTION sf_sla.reject_mutation() TO sf_cmp029_rw;
GRANT EXECUTE ON FUNCTION sf_sla.guard_policy_mutation() TO sf_cmp029_rw;
GRANT EXECUTE ON FUNCTION sf_sla.guard_clock_transition() TO sf_cmp029_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_sla FROM sf_cmp029_rw;
REVOKE ALL ON SCHEMA sf_sla FROM sf_app;
DROP SCHEMA IF EXISTS sf_sla CASCADE;
-- Role sf_cmp029_rw retained (may be referenced by runtime logins); never DROP ROLE here.
