-- CMP-056 Scheduler & Appointment (SF-M09-001; INT-014, INT-011). ADR-0006 Option A: sf_cmp056_rw
-- NOLOGIN holds DML; FORCE RLS; PUBLIC revoked; runtime is not the table owner (sf_migrator).
-- CMP-056 owns bookable slots (explicit tenant-published metadata), appointments (SF-CON-APPOINTMENT),
-- appointment history and CMP-025 notification outcomes. It holds no business calendar, holiday
-- list or statutory hearing/inspection calendar. Capacity is atomic: a seat is taken only by a
-- conditional UPDATE (booked_count < capacity) and a deferred constraint trigger proves at commit
-- that booked_count equals the number of seat-holding appointments. Notification outcomes are
-- append-only and can never change an appointment. This migration grants nothing on peer schemas.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp056_rw') THEN
    CREATE ROLE sf_cmp056_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp056_rw IS
  'ADR-0006: CMP-056 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_scheduler AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_scheduler IS
  'isolation_class=TENANT_SCOPED; owner=CMP-056; appointment slots, appointments, history, notification outcomes';

REVOKE ALL ON SCHEMA sf_scheduler FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_scheduler TO sf_cmp056_rw;
GRANT USAGE ON SCHEMA sf_scheduler TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_scheduler REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_scheduler REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_scheduler REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_scheduler.slot TENANT_SCOPED owner=CMP-056
CREATE TABLE sf_scheduler.slot (
  tenant_id uuid NOT NULL,
  slot_id uuid NOT NULL,
  slot_ref text NOT NULL CHECK (slot_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  appointment_type_ref text NOT NULL CHECK (appointment_type_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  resource_calendar_ref text CHECK (resource_calendar_ref IS NULL OR resource_calendar_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  jurisdiction_id uuid,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 10000),
  booked_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  capacity_atomic boolean NOT NULL DEFAULT true CHECK (capacity_atomic = true),
  invented_statutory_policy_forbidden boolean NOT NULL DEFAULT true
    CHECK (invented_statutory_policy_forbidden = true),
  actor_type text NOT NULL CHECK (actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  created_by uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, slot_id),
  UNIQUE (tenant_id, slot_ref),
  CHECK (ends_at > starts_at),
  CHECK (booked_count >= 0 AND booked_count <= capacity)
);
CREATE INDEX slot_bookable_idx ON sf_scheduler.slot (tenant_id, appointment_type_ref, starts_at)
  WHERE status = 'OPEN';
ALTER TABLE sf_scheduler.slot ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_scheduler.slot FORCE ROW LEVEL SECURITY;
CREATE POLICY slot_isolation ON sf_scheduler.slot TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_scheduler.slot OWNER TO sf_migrator;

-- sf:isolation sf_scheduler.appointment TENANT_SCOPED owner=CMP-056
CREATE TABLE sf_scheduler.appointment (
  tenant_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  appointment_type_ref text NOT NULL CHECK (appointment_type_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  slot_id uuid NOT NULL,
  slot_ref text NOT NULL CHECK (slot_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  resource_calendar_ref text CHECK (resource_calendar_ref IS NULL OR resource_calendar_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  application_id uuid,
  lifecycle_status text NOT NULL
    CHECK (lifecycle_status IN ('BOOKED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  version integer NOT NULL CHECK (version >= 1),
  capacity_atomic boolean NOT NULL DEFAULT true CHECK (capacity_atomic = true),
  notification_failure_invalidates_booking boolean NOT NULL DEFAULT false
    CHECK (notification_failure_invalidates_booking = false),
  invented_statutory_policy_forbidden boolean NOT NULL DEFAULT true
    CHECK (invented_statutory_policy_forbidden = true),
  correlation_id uuid NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  booked_by uuid NOT NULL,
  booked_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, appointment_id),
  FOREIGN KEY (tenant_id, slot_id) REFERENCES sf_scheduler.slot (tenant_id, slot_id)
);
CREATE INDEX appointment_slot_idx ON sf_scheduler.appointment (tenant_id, slot_id)
  WHERE lifecycle_status <> 'CANCELLED';
CREATE INDEX appointment_application_idx ON sf_scheduler.appointment (tenant_id, application_id)
  WHERE application_id IS NOT NULL;
ALTER TABLE sf_scheduler.appointment ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_scheduler.appointment FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_isolation ON sf_scheduler.appointment TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_scheduler.appointment OWNER TO sf_migrator;

-- sf:isolation sf_scheduler.appointment_event TENANT_SCOPED owner=CMP-056
CREATE TABLE sf_scheduler.appointment_event (
  tenant_id uuid NOT NULL,
  appointment_event_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  from_status text CHECK (from_status IS NULL OR from_status IN ('BOOKED', 'RESCHEDULED')),
  to_status text NOT NULL
    CHECK (to_status IN ('BOOKED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')),
  slot_ref text NOT NULL CHECK (slot_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  previous_slot_ref text CHECK (previous_slot_ref IS NULL OR previous_slot_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  actor_type text NOT NULL CHECK (actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  actor_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, appointment_event_id),
  UNIQUE (tenant_id, appointment_id, version),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES sf_scheduler.appointment (tenant_id, appointment_id),
  CHECK ((version = 1) = (from_status IS NULL)),
  CHECK ((to_status = 'RESCHEDULED') = (previous_slot_ref IS NOT NULL))
);
ALTER TABLE sf_scheduler.appointment_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_scheduler.appointment_event FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_event_isolation ON sf_scheduler.appointment_event TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_scheduler.appointment_event OWNER TO sf_migrator;

-- sf:isolation sf_scheduler.notification_outcome TENANT_SCOPED owner=CMP-056
CREATE TABLE sf_scheduler.notification_outcome (
  tenant_id uuid NOT NULL,
  outcome_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('SUCCEEDED', 'FAILED')),
  outcome_ref text NOT NULL CHECK (outcome_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^SF-(AUTH|TEN|FORM|RULE|APP|EVD|PAY|WF|CRED|INT|RATE|AI|SYS)-[0-9]{3}$'),
  booking_invalidated boolean NOT NULL DEFAULT false CHECK (booking_invalidated = false),
  actor_type text NOT NULL CHECK (actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  recorded_by uuid NOT NULL,
  correlation_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, outcome_id),
  UNIQUE (tenant_id, appointment_id, outcome_ref),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES sf_scheduler.appointment (tenant_id, appointment_id),
  CHECK ((outcome = 'FAILED') = (failure_code IS NOT NULL))
);
ALTER TABLE sf_scheduler.notification_outcome ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_scheduler.notification_outcome FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_outcome_isolation ON sf_scheduler.notification_outcome TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_scheduler.notification_outcome OWNER TO sf_migrator;

-- sf:isolation sf_scheduler.idempotency_record TENANT_SCOPED owner=CMP-056
CREATE TABLE sf_scheduler.idempotency_record (
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
ALTER TABLE sf_scheduler.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_scheduler.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_scheduler.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_scheduler.idempotency_record OWNER TO sf_migrator;

-- Append-only: history and notification outcomes are never changed; slots/appointments never deleted.
CREATE FUNCTION sf_scheduler.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_scheduler, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'scheduler provenance is append-only' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_scheduler.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER slot_no_delete
  BEFORE DELETE ON sf_scheduler.slot
  FOR EACH ROW EXECUTE FUNCTION sf_scheduler.reject_mutation();
CREATE TRIGGER appointment_no_delete
  BEFORE DELETE ON sf_scheduler.appointment
  FOR EACH ROW EXECUTE FUNCTION sf_scheduler.reject_mutation();
CREATE TRIGGER appointment_event_immutable
  BEFORE UPDATE OR DELETE ON sf_scheduler.appointment_event
  FOR EACH ROW EXECUTE FUNCTION sf_scheduler.reject_mutation();
CREATE TRIGGER notification_outcome_immutable
  BEFORE UPDATE OR DELETE ON sf_scheduler.notification_outcome
  FOR EACH ROW EXECUTE FUNCTION sf_scheduler.reject_mutation();

-- Slots are published empty and OPEN; their definition is immutable; CLOSED never reopens.
CREATE FUNCTION sf_scheduler.guard_slot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_scheduler, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.booked_count <> 0 OR NEW.status <> 'OPEN' THEN
      RAISE EXCEPTION 'slot must be published OPEN and empty' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.slot_id, NEW.slot_ref, NEW.appointment_type_ref, NEW.resource_calendar_ref,
      NEW.jurisdiction_id, NEW.starts_at, NEW.ends_at, NEW.capacity, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.slot_id, OLD.slot_ref, OLD.appointment_type_ref, OLD.resource_calendar_ref,
      OLD.jurisdiction_id, OLD.starts_at, OLD.ends_at, OLD.capacity, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'slot definition is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'CLOSED' AND NEW.status = 'OPEN' THEN
    RAISE EXCEPTION 'a closed slot cannot reopen' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_scheduler.guard_slot() OWNER TO sf_migrator;

CREATE TRIGGER slot_guard
  BEFORE INSERT OR UPDATE ON sf_scheduler.slot
  FOR EACH ROW EXECUTE FUNCTION sf_scheduler.guard_slot();

-- Lifecycle: created BOOKED at version 1; BOOKED/RESCHEDULED -> RESCHEDULED (different slot of the
-- same appointment type) | CANCELLED | COMPLETED | NO_SHOW (same slot); terminal states never change.
-- Each update increments version by exactly one. Invalid transitions raise 55000.
CREATE FUNCTION sf_scheduler.guard_appointment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_scheduler, pg_temp
AS $$
DECLARE
  target_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_status <> 'BOOKED' OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'appointment must be created BOOKED at version 1' USING ERRCODE = '55000';
    END IF;
  ELSE
    IF (NEW.tenant_id, NEW.appointment_id, NEW.appointment_type_ref, NEW.application_id,
        NEW.idempotency_key, NEW.correlation_id, NEW.actor_type, NEW.booked_by, NEW.booked_at)
       IS DISTINCT FROM
       (OLD.tenant_id, OLD.appointment_id, OLD.appointment_type_ref, OLD.application_id,
        OLD.idempotency_key, OLD.correlation_id, OLD.actor_type, OLD.booked_by, OLD.booked_at) THEN
      RAISE EXCEPTION 'appointment provenance is immutable' USING ERRCODE = '42501';
    END IF;
    IF OLD.lifecycle_status NOT IN ('BOOKED', 'RESCHEDULED') OR NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'invalid appointment transition' USING ERRCODE = '55000';
    END IF;
    IF NEW.lifecycle_status = 'RESCHEDULED' THEN
      IF NEW.slot_id = OLD.slot_id THEN
        RAISE EXCEPTION 'reschedule requires a different slot' USING ERRCODE = '55000';
      END IF;
    ELSIF NEW.lifecycle_status IN ('CANCELLED', 'COMPLETED', 'NO_SHOW') THEN
      IF (NEW.slot_id, NEW.slot_ref, NEW.resource_calendar_ref)
         IS DISTINCT FROM (OLD.slot_id, OLD.slot_ref, OLD.resource_calendar_ref) THEN
        RAISE EXCEPTION 'only a reschedule may change the slot' USING ERRCODE = '55000';
      END IF;
    ELSE
      RAISE EXCEPTION 'invalid appointment transition' USING ERRCODE = '55000';
    END IF;
  END IF;
  SELECT s.appointment_type_ref INTO target_type
    FROM sf_scheduler.slot s
   WHERE s.tenant_id = NEW.tenant_id AND s.slot_id = NEW.slot_id AND s.slot_ref = NEW.slot_ref
     AND s.resource_calendar_ref IS NOT DISTINCT FROM NEW.resource_calendar_ref;
  IF target_type IS DISTINCT FROM NEW.appointment_type_ref THEN
    RAISE EXCEPTION 'appointment must match its slot and appointment type' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_scheduler.guard_appointment() OWNER TO sf_migrator;

CREATE TRIGGER appointment_guard
  BEFORE INSERT OR UPDATE ON sf_scheduler.appointment
  FOR EACH ROW EXECUTE FUNCTION sf_scheduler.guard_appointment();

-- Occupancy invariant, checked at commit: booked_count equals the seat-holding appointments
-- (every status except CANCELLED). A seat change without the matching appointment change, or an
-- appointment change without the matching seat change, aborts the transaction with 55000.
CREATE FUNCTION sf_scheduler.assert_slot_occupancy(p_tenant uuid, p_slot uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = sf_scheduler, pg_temp
AS $$
DECLARE
  recorded integer;
  holding integer;
BEGIN
  -- FOR SHARE: no seat can move between reading booked_count and counting appointments.
  SELECT s.booked_count INTO recorded
    FROM sf_scheduler.slot s WHERE s.tenant_id = p_tenant AND s.slot_id = p_slot FOR SHARE;
  SELECT count(*) INTO holding
    FROM sf_scheduler.appointment a
   WHERE a.tenant_id = p_tenant AND a.slot_id = p_slot AND a.lifecycle_status <> 'CANCELLED';
  IF recorded IS DISTINCT FROM holding THEN
    RAISE EXCEPTION 'slot occupancy does not match its appointments' USING ERRCODE = '55000';
  END IF;
END;
$$;
ALTER FUNCTION sf_scheduler.assert_slot_occupancy(uuid, uuid) OWNER TO sf_migrator;

CREATE FUNCTION sf_scheduler.check_occupancy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_scheduler, pg_temp
AS $$
BEGIN
  PERFORM sf_scheduler.assert_slot_occupancy(NEW.tenant_id, NEW.slot_id);
  IF TG_TABLE_NAME = 'appointment' AND TG_OP = 'UPDATE' AND OLD.slot_id <> NEW.slot_id THEN
    PERFORM sf_scheduler.assert_slot_occupancy(OLD.tenant_id, OLD.slot_id);
  END IF;
  RETURN NULL;
END;
$$;
ALTER FUNCTION sf_scheduler.check_occupancy() OWNER TO sf_migrator;

CREATE CONSTRAINT TRIGGER slot_occupancy
  AFTER UPDATE OF booked_count ON sf_scheduler.slot
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sf_scheduler.check_occupancy();
CREATE CONSTRAINT TRIGGER appointment_occupancy
  AFTER INSERT OR UPDATE ON sf_scheduler.appointment
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sf_scheduler.check_occupancy();

-- History and outcomes refer to an existing appointment version of the same tenant (FK) and
-- must not be appended for a version the appointment has not reached.
CREATE FUNCTION sf_scheduler.guard_history_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_scheduler, pg_temp
AS $$
DECLARE
  current_version integer;
  current_status text;
BEGIN
  SELECT a.version, a.lifecycle_status INTO current_version, current_status
    FROM sf_scheduler.appointment a
   WHERE a.tenant_id = NEW.tenant_id AND a.appointment_id = NEW.appointment_id;
  IF current_version IS DISTINCT FROM NEW.version OR current_status IS DISTINCT FROM NEW.to_status THEN
    RAISE EXCEPTION 'history must record the current appointment version' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_scheduler.guard_history_insert() OWNER TO sf_migrator;

CREATE TRIGGER appointment_event_insert_guard
  BEFORE INSERT ON sf_scheduler.appointment_event
  FOR EACH ROW EXECUTE FUNCTION sf_scheduler.guard_history_insert();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_scheduler FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_scheduler FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_scheduler FROM PUBLIC;

GRANT SELECT, INSERT ON sf_scheduler.slot TO sf_cmp056_rw;
GRANT UPDATE (booked_count, status, updated_at) ON sf_scheduler.slot TO sf_cmp056_rw;
GRANT SELECT, INSERT ON sf_scheduler.appointment TO sf_cmp056_rw;
GRANT UPDATE (lifecycle_status, slot_id, slot_ref, resource_calendar_ref, version, updated_at)
  ON sf_scheduler.appointment TO sf_cmp056_rw;
GRANT SELECT, INSERT ON sf_scheduler.appointment_event TO sf_cmp056_rw;
GRANT SELECT, INSERT ON sf_scheduler.notification_outcome TO sf_cmp056_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_scheduler.idempotency_record TO sf_cmp056_rw;

GRANT EXECUTE ON FUNCTION sf_scheduler.reject_mutation() TO sf_cmp056_rw;
GRANT EXECUTE ON FUNCTION sf_scheduler.guard_slot() TO sf_cmp056_rw;
GRANT EXECUTE ON FUNCTION sf_scheduler.guard_appointment() TO sf_cmp056_rw;
GRANT EXECUTE ON FUNCTION sf_scheduler.assert_slot_occupancy(uuid, uuid) TO sf_cmp056_rw;
GRANT EXECUTE ON FUNCTION sf_scheduler.check_occupancy() TO sf_cmp056_rw;
GRANT EXECUTE ON FUNCTION sf_scheduler.guard_history_insert() TO sf_cmp056_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_scheduler FROM sf_cmp056_rw;
REVOKE ALL ON SCHEMA sf_scheduler FROM sf_app;
DROP SCHEMA IF EXISTS sf_scheduler CASCADE;
-- Role sf_cmp056_rw retained (may be referenced by runtime logins); never DROP ROLE here.
