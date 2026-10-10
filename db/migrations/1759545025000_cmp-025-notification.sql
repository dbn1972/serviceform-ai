-- CMP-025 Notification Service (SF-M06-002). ADR-0006 Option A: sf_cmp025_rw NOLOGIN holds DML;
-- FORCE RLS; PUBLIC revoked; runtime is not the table owner (sf_migrator).
-- CMP-025 owns notification templates (immutable published versions), dispatch records and delivery
-- attempts only. Recipient addresses, provider payloads and secrets are never stored here: a dispatch
-- carries a recipient handle reference, template parameters that passed the PII guard, and the
-- INT-013 connector mode (plus a SimulationMarker when SIMULATED). Provider calls happen outside any
-- database transaction. This migration grants no privilege on peer component schemas.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp025_rw') THEN
    CREATE ROLE sf_cmp025_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp025_rw IS
  'ADR-0006: CMP-025 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_notification AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_notification IS
  'isolation_class=TENANT_SCOPED; owner=CMP-025; notification templates, dispatches, delivery attempts';

REVOKE ALL ON SCHEMA sf_notification FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_notification TO sf_cmp025_rw;
GRANT USAGE ON SCHEMA sf_notification TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_notification REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_notification REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_notification REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_notification.notification_template TENANT_SCOPED owner=CMP-025
CREATE TABLE sf_notification.notification_template (
  tenant_id uuid NOT NULL,
  template_ref text NOT NULL CHECK (template_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  template_version integer NOT NULL CHECK (template_version >= 1),
  channel text NOT NULL CHECK (channel IN ('SMS', 'EMAIL', 'PUSH', 'IN_APP')),
  locale text NOT NULL CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  subject_template text CHECK (subject_template IS NULL OR char_length(subject_template) BETWEEN 1 AND 300),
  body_template text NOT NULL CHECK (char_length(body_template) BETWEEN 1 AND 4000),
  allowed_params text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(allowed_params) <= 32),
  published_by uuid NOT NULL,
  published_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, template_ref, template_version, channel, locale)
);
ALTER TABLE sf_notification.notification_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_notification.notification_template FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_template_isolation ON sf_notification.notification_template TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_notification.notification_template OWNER TO sf_migrator;

-- sf:isolation sf_notification.notification_dispatch TENANT_SCOPED owner=CMP-025
CREATE TABLE sf_notification.notification_dispatch (
  tenant_id uuid NOT NULL,
  dispatch_id uuid NOT NULL,
  application_id uuid,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  template_ref text NOT NULL CHECK (template_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  template_version integer NOT NULL CHECK (template_version >= 1),
  channel text NOT NULL CHECK (channel IN ('SMS', 'EMAIL', 'PUSH', 'IN_APP')),
  locale text NOT NULL CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  recipient_handle_class text NOT NULL
    CHECK (recipient_handle_class IN ('CITIZEN_HANDLE_REF', 'OFFICIAL_HANDLE_REF', 'SYSTEM_HANDLE_REF')),
  recipient_handle_ref text NOT NULL CHECK (recipient_handle_ref ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  template_params jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(template_params) = 'object' AND octet_length(template_params::text) <= 4096),
  connector_binding_id uuid NOT NULL,
  connector_mode text NOT NULL CHECK (connector_mode IN ('REAL', 'SANDBOX', 'SIMULATED')),
  connector_environment text NOT NULL
    CHECK (connector_environment IN ('LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE', 'UAT', 'PREPROD', 'PRODUCTION')),
  connector_critical boolean NOT NULL,
  simulation_marker jsonb,
  status text NOT NULL
    CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'UNDELIVERED', 'FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  next_attempt_at timestamptz NOT NULL,
  lease_owner text CHECK (lease_owner IS NULL OR char_length(lease_owner) BETWEEN 1 AND 128),
  lease_expires_at timestamptz,
  provider_message_ref text CHECK (provider_message_ref IS NULL OR char_length(provider_message_ref) BETWEEN 1 AND 200),
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL,
  sent_at timestamptz,
  delivered_at timestamptz,
  correlation_id uuid NOT NULL,
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, dispatch_id),
  UNIQUE (tenant_id, idempotency_key),
  -- INT-013 / Constitution #22: a SIMULATED dispatch always carries a SimulationMarker and may only
  -- exist in a simulation environment; production-critical connectors must be REAL.
  CHECK ((connector_mode = 'SIMULATED') = (simulation_marker IS NOT NULL)),
  CHECK (connector_mode <> 'SIMULATED' OR connector_environment IN ('LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE')),
  CHECK (NOT (connector_environment = 'PRODUCTION' AND connector_critical AND connector_mode <> 'REAL')),
  CHECK (connector_environment NOT IN ('LOCAL', 'CI') OR connector_mode = 'SIMULATED'),
  CHECK (status <> 'SENDING' OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (status NOT IN ('SENT', 'DELIVERED', 'UNDELIVERED') OR sent_at IS NOT NULL),
  CHECK (status <> 'DELIVERED' OR delivered_at IS NOT NULL),
  CHECK (attempts <= max_attempts + 1)
);
CREATE INDEX notification_dispatch_due_idx
  ON sf_notification.notification_dispatch (tenant_id, next_attempt_at)
  WHERE status IN ('QUEUED', 'SENDING');
CREATE INDEX notification_dispatch_application_idx
  ON sf_notification.notification_dispatch (tenant_id, application_id)
  WHERE application_id IS NOT NULL;
ALTER TABLE sf_notification.notification_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_notification.notification_dispatch FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_dispatch_isolation ON sf_notification.notification_dispatch TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_notification.notification_dispatch OWNER TO sf_migrator;

-- sf:isolation sf_notification.dispatch_attempt TENANT_SCOPED owner=CMP-025
CREATE TABLE sf_notification.dispatch_attempt (
  tenant_id uuid NOT NULL,
  dispatch_id uuid NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no >= 1),
  outcome text NOT NULL
    CHECK (outcome IN ('ACCEPTED', 'TRANSIENT_FAILURE', 'PERMANENT_FAILURE', 'ABANDONED')),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  provider_message_ref text CHECK (provider_message_ref IS NULL OR char_length(provider_message_ref) BETWEEN 1 AND 200),
  connector_mode text NOT NULL CHECK (connector_mode IN ('REAL', 'SANDBOX', 'SIMULATED')),
  simulation_marker jsonb,
  occurred_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, dispatch_id, attempt_no),
  FOREIGN KEY (tenant_id, dispatch_id)
    REFERENCES sf_notification.notification_dispatch (tenant_id, dispatch_id),
  CHECK ((connector_mode = 'SIMULATED') = (simulation_marker IS NOT NULL))
);
ALTER TABLE sf_notification.dispatch_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_notification.dispatch_attempt FORCE ROW LEVEL SECURITY;
CREATE POLICY dispatch_attempt_isolation ON sf_notification.dispatch_attempt TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_notification.dispatch_attempt OWNER TO sf_migrator;

-- sf:isolation sf_notification.idempotency_record TENANT_SCOPED owner=CMP-025
CREATE TABLE sf_notification.idempotency_record (
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
ALTER TABLE sf_notification.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_notification.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_notification.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_notification.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_notification.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_notification, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'insert-only notification row' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_notification.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER notification_template_immutable
  BEFORE UPDATE OR DELETE ON sf_notification.notification_template
  FOR EACH ROW EXECUTE FUNCTION sf_notification.reject_mutation();

CREATE TRIGGER dispatch_attempt_immutable
  BEFORE UPDATE OR DELETE ON sf_notification.dispatch_attempt
  FOR EACH ROW EXECUTE FUNCTION sf_notification.reject_mutation();

CREATE FUNCTION sf_notification.guard_dispatch_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_notification, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'notification dispatches are retained' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'QUEUED' OR NEW.attempts <> 0 THEN
      RAISE EXCEPTION 'notification dispatch must start QUEUED with zero attempts';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('FAILED', 'DELIVERED', 'UNDELIVERED') THEN
    RAISE EXCEPTION 'terminal notification dispatch is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.dispatch_id IS DISTINCT FROM OLD.dispatch_id
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.cell_id IS DISTINCT FROM OLD.cell_id
     OR NEW.template_ref IS DISTINCT FROM OLD.template_ref
     OR NEW.template_version IS DISTINCT FROM OLD.template_version
     OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.locale IS DISTINCT FROM OLD.locale
     OR NEW.recipient_handle_class IS DISTINCT FROM OLD.recipient_handle_class
     OR NEW.recipient_handle_ref IS DISTINCT FROM OLD.recipient_handle_ref
     OR NEW.template_params IS DISTINCT FROM OLD.template_params
     OR NEW.connector_binding_id IS DISTINCT FROM OLD.connector_binding_id
     OR NEW.connector_mode IS DISTINCT FROM OLD.connector_mode
     OR NEW.connector_environment IS DISTINCT FROM OLD.connector_environment
     OR NEW.connector_critical IS DISTINCT FROM OLD.connector_critical
     OR NEW.simulation_marker IS DISTINCT FROM OLD.simulation_marker
     OR NEW.max_attempts IS DISTINCT FROM OLD.max_attempts
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id THEN
    RAISE EXCEPTION 'notification dispatch identity and routing are immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.aggregate_version <> OLD.aggregate_version + 1 THEN
    RAISE EXCEPTION 'notification aggregate_version must advance by one';
  END IF;
  IF NOT (
       (OLD.status = 'QUEUED' AND NEW.status = 'SENDING')
    OR (OLD.status = 'SENDING' AND NEW.status IN ('SENDING', 'QUEUED', 'SENT', 'FAILED'))
    OR (OLD.status = 'SENT' AND NEW.status IN ('DELIVERED', 'UNDELIVERED'))
  ) THEN
    RAISE EXCEPTION 'notification transition % -> % refused', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_notification.guard_dispatch_transition() OWNER TO sf_migrator;

CREATE TRIGGER notification_dispatch_transition_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_notification.notification_dispatch
  FOR EACH ROW EXECUTE FUNCTION sf_notification.guard_dispatch_transition();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_notification FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_notification FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_notification FROM PUBLIC;

GRANT SELECT, INSERT ON sf_notification.notification_template TO sf_cmp025_rw;
GRANT SELECT, INSERT,
  UPDATE (
    status, attempts, next_attempt_at, lease_owner, lease_expires_at, provider_message_ref,
    last_error_code, sent_at, delivered_at, aggregate_version, updated_at
  )
  ON sf_notification.notification_dispatch TO sf_cmp025_rw;
GRANT SELECT, INSERT ON sf_notification.dispatch_attempt TO sf_cmp025_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_notification.idempotency_record TO sf_cmp025_rw;

GRANT EXECUTE ON FUNCTION sf_notification.reject_mutation() TO sf_cmp025_rw;
GRANT EXECUTE ON FUNCTION sf_notification.guard_dispatch_transition() TO sf_cmp025_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_notification FROM sf_cmp025_rw;
REVOKE ALL ON SCHEMA sf_notification FROM sf_app;
DROP SCHEMA IF EXISTS sf_notification CASCADE;
-- Role sf_cmp025_rw retained (may be referenced by runtime logins); never DROP ROLE here.
