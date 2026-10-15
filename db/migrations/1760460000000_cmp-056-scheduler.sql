-- CMP-056 Appointment / Scheduler (SF-M09-001). ADR-0006 Option A: sf_cmp056_rw NOLOGIN holds DML;
-- FORCE RLS; PUBLIC revoked; runtime is not the table owner (sf_migrator).
-- FROZEN SF-CON-APPOINTMENT: capacity_atomic=true (single-capacity slots cannot overbook);
-- notification_failure_invalidates_booking=false; invented_statutory_policy_forbidden=true.
-- No hearing/inspection statutory calendars are invented here — appointment_type_ref and slot_ref
-- are opaque owner-supplied metadata references.
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
  'isolation_class=TENANT_SCOPED; owner=CMP-056; appointment/slot booking (SF-CON-APPOINTMENT)';

REVOKE ALL ON SCHEMA sf_scheduler FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_scheduler TO sf_cmp056_rw;
GRANT USAGE ON SCHEMA sf_scheduler TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_scheduler REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_scheduler REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_scheduler REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_scheduler.appointment_type TENANT_SCOPED owner=CMP-056
CREATE TABLE sf_scheduler.appointment_type (
  tenant_id uuid NOT NULL,
  appointment_type_id uuid NOT NULL,
  appointment_type_ref text NOT NULL CHECK (
    char_length(appointment_type_ref) BETWEEN 1 AND 128
  ),
  resource_calendar_ref text CHECK (
    resource_calendar_ref IS NULL OR char_length(resource_calendar_ref) BETWEEN 1 AND 128
  ),
  invented_statutory_policy_forbidden boolean NOT NULL DEFAULT true
    CHECK (invented_statutory_policy_forbidden),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  last_correlation_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, appointment_type_id),
  UNIQUE (tenant_id, appointment_type_ref)
);
ALTER TABLE sf_scheduler.appointment_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_scheduler.appointment_type FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_type_isolation ON sf_scheduler.appointment_type TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_scheduler.appointment_type OWNER TO sf_migrator;

-- sf:isolation sf_scheduler.slot TENANT_SCOPED owner=CMP-056
CREATE TABLE sf_scheduler.slot (
  tenant_id uuid NOT NULL,
  slot_id uuid NOT NULL,
  slot_ref text NOT NULL CHECK (char_length(slot_ref) BETWEEN 1 AND 128),
  appointment_type_id uuid NOT NULL,
  capacity integer NOT NULL CHECK (capacity >= 1 AND capacity <= 10000),
  booked_count integer NOT NULL DEFAULT 0 CHECK (booked_count >= 0),
  capacity_atomic boolean NOT NULL DEFAULT true CHECK (capacity_atomic),
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_correlation_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, slot_id),
  UNIQUE (tenant_id, slot_ref),
  CHECK (closes_at > opens_at),
  CHECK (booked_count <= capacity),
  FOREIGN KEY (tenant_id, appointment_type_id)
    REFERENCES sf_scheduler.appointment_type (tenant_id, appointment_type_id)
);
CREATE INDEX slot_type_availability_idx
  ON sf_scheduler.slot (tenant_id, appointment_type_id, opens_at)
  WHERE booked_count < capacity;
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
  appointment_type_id uuid NOT NULL,
  appointment_type_ref text NOT NULL CHECK (char_length(appointment_type_ref) BETWEEN 1 AND 128),
  slot_id uuid NOT NULL,
  slot_ref text NOT NULL CHECK (char_length(slot_ref) BETWEEN 1 AND 128),
  resource_calendar_ref text CHECK (
    resource_calendar_ref IS NULL OR char_length(resource_calendar_ref) BETWEEN 1 AND 128
  ),
  lifecycle_status text NOT NULL CHECK (
    lifecycle_status IN ('BOOKED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')
  ),
  appointment_version bigint NOT NULL CHECK (appointment_version >= 1),
  capacity_atomic boolean NOT NULL DEFAULT true CHECK (capacity_atomic),
  notification_failure_invalidates_booking boolean NOT NULL DEFAULT false
    CHECK (NOT notification_failure_invalidates_booking),
  invented_statutory_policy_forbidden boolean NOT NULL DEFAULT true
    CHECK (invented_statutory_policy_forbidden),
  participant_ref text CHECK (
    participant_ref IS NULL OR char_length(participant_ref) BETWEEN 1 AND 128
  ),
  notification_status text NOT NULL DEFAULT 'PENDING' CHECK (
    notification_status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  last_correlation_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, appointment_id),
  FOREIGN KEY (tenant_id, appointment_type_id)
    REFERENCES sf_scheduler.appointment_type (tenant_id, appointment_type_id),
  FOREIGN KEY (tenant_id, slot_id)
    REFERENCES sf_scheduler.slot (tenant_id, slot_id)
);
CREATE INDEX appointment_slot_active_idx
  ON sf_scheduler.appointment (tenant_id, slot_id)
  WHERE lifecycle_status IN ('BOOKED', 'RESCHEDULED');
ALTER TABLE sf_scheduler.appointment ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_scheduler.appointment FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_isolation ON sf_scheduler.appointment TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_scheduler.appointment OWNER TO sf_migrator;

-- sf:isolation sf_scheduler.appointment_event_log TENANT_SCOPED owner=CMP-056
CREATE TABLE sf_scheduler.appointment_event_log (
  tenant_id uuid NOT NULL,
  event_log_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  from_status text CHECK (
    from_status IS NULL OR from_status IN ('BOOKED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')
  ),
  to_status text NOT NULL CHECK (
    to_status IN ('BOOKED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')
  ),
  from_slot_ref text,
  to_slot_ref text NOT NULL,
  appointment_version bigint NOT NULL CHECK (appointment_version >= 1),
  actor_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_log_id),
  UNIQUE (tenant_id, appointment_id, appointment_version),
  FOREIGN KEY (tenant_id, appointment_id)
    REFERENCES sf_scheduler.appointment (tenant_id, appointment_id)
);
ALTER TABLE sf_scheduler.appointment_event_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_scheduler.appointment_event_log FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_event_log_isolation ON sf_scheduler.appointment_event_log TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_scheduler.appointment_event_log OWNER TO sf_migrator;

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

CREATE FUNCTION sf_scheduler.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_scheduler, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'insert-only scheduler row' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_scheduler.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER appointment_event_log_immutable
  BEFORE UPDATE OR DELETE ON sf_scheduler.appointment_event_log
  FOR EACH ROW EXECUTE FUNCTION sf_scheduler.reject_mutation();

-- Atomic capacity: refuse any booking that would exceed capacity. Invoker-mode so RLS applies.
CREATE FUNCTION sf_scheduler.guard_slot_capacity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_scheduler, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'scheduler slots are never deleted' USING ERRCODE = '42501';
  END IF;
  IF NEW.capacity_atomic IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'capacity_atomic must remain true'
      USING ERRCODE = 'P0001', HINT = 'SF_CAPACITY_ATOMIC';
  END IF;
  IF NEW.booked_count > NEW.capacity THEN
    RAISE EXCEPTION 'slot capacity exceeded (atomic)'
      USING ERRCODE = 'P0001', HINT = 'SF_SLOT_FULL';
  END IF;
  IF NEW.booked_count < 0 THEN
    RAISE EXCEPTION 'booked_count cannot be negative'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_scheduler.guard_slot_capacity() OWNER TO sf_migrator;

CREATE TRIGGER slot_capacity_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_scheduler.slot
  FOR EACH ROW EXECUTE FUNCTION sf_scheduler.guard_slot_capacity();

CREATE FUNCTION sf_scheduler.guard_appointment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_scheduler, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'appointments are never deleted' USING ERRCODE = '42501';
  END IF;
  IF NEW.capacity_atomic IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'capacity_atomic must remain true'
      USING ERRCODE = 'P0001', HINT = 'SF_CAPACITY_ATOMIC';
  END IF;
  IF NEW.notification_failure_invalidates_booking IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'notification failure must not invalidate a booking'
      USING ERRCODE = 'P0001', HINT = 'SF_NOTIFY_MUST_NOT_INVALIDATE';
  END IF;
  IF NEW.invented_statutory_policy_forbidden IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'invented statutory policy is forbidden'
      USING ERRCODE = 'P0001', HINT = 'SF_NO_STATUTORY_CALENDAR';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_status <> 'BOOKED' OR NEW.appointment_version <> 1 THEN
      RAISE EXCEPTION 'an appointment is booked at version 1'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.appointment_id, NEW.appointment_type_id, NEW.appointment_type_ref,
      NEW.created_at, NEW.created_by)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.appointment_id, OLD.appointment_type_id, OLD.appointment_type_ref,
      OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION 'appointment identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.appointment_version <> OLD.appointment_version + 1 THEN
    RAISE EXCEPTION 'appointment_version must advance by one'
      USING ERRCODE = 'P0001', HINT = 'SF_STALE_VERSION';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_scheduler.guard_appointment() OWNER TO sf_migrator;

CREATE TRIGGER appointment_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_scheduler.appointment
  FOR EACH ROW EXECUTE FUNCTION sf_scheduler.guard_appointment();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_scheduler FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_scheduler FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_scheduler FROM PUBLIC;

GRANT SELECT, INSERT ON sf_scheduler.appointment_type TO sf_cmp056_rw;
GRANT SELECT, INSERT,
  UPDATE (booked_count, updated_at, last_correlation_id)
  ON sf_scheduler.slot TO sf_cmp056_rw;
GRANT SELECT, INSERT,
  UPDATE (
    slot_id, slot_ref, lifecycle_status, appointment_version, notification_status,
    updated_at, last_correlation_id, resource_calendar_ref
  )
  ON sf_scheduler.appointment TO sf_cmp056_rw;
GRANT SELECT, INSERT ON sf_scheduler.appointment_event_log TO sf_cmp056_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_scheduler.idempotency_record TO sf_cmp056_rw;

GRANT EXECUTE ON FUNCTION sf_scheduler.reject_mutation() TO sf_cmp056_rw;
GRANT EXECUTE ON FUNCTION sf_scheduler.guard_slot_capacity() TO sf_cmp056_rw;
GRANT EXECUTE ON FUNCTION sf_scheduler.guard_appointment() TO sf_cmp056_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_scheduler FROM sf_cmp056_rw;
REVOKE ALL ON SCHEMA sf_scheduler FROM sf_app;
DROP SCHEMA IF EXISTS sf_scheduler CASCADE;
-- Role sf_cmp056_rw retained (may be referenced by runtime logins); never DROP ROLE here.
