-- CMP-046 Operational Dashboard (SF-M08-004). ADR-0006 Option A: sf_cmp046_rw NOLOGIN holds DML;
-- FORCE RLS; PUBLIC revoked; runtime is not the table owner (sf_migrator).
-- CMP-046 owns DERIVED, NON-AUTHORITATIVE operational read models only (aggregate snapshots of
-- SLA, queue, integration, event and platform health). Case, task and SLA-clock state stay with
-- their owners and are read through ports; this migration grants no privilege on peer schemas.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp046_rw') THEN
    CREATE ROLE sf_cmp046_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp046_rw IS
  'ADR-0006: CMP-046 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_ops_dashboard AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_ops_dashboard IS
  'isolation_class=TENANT_SCOPED; owner=CMP-046; derived non-authoritative operational read models';

REVOKE ALL ON SCHEMA sf_ops_dashboard FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_ops_dashboard TO sf_cmp046_rw;
GRANT USAGE ON SCHEMA sf_ops_dashboard TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_ops_dashboard REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_ops_dashboard REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_ops_dashboard REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_ops_dashboard.ops_view_snapshot TENANT_SCOPED owner=CMP-046
CREATE TABLE sf_ops_dashboard.ops_view_snapshot (
  tenant_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  view_code text NOT NULL CHECK (
    view_code IN ('SLA_SUMMARY', 'QUEUE_SUMMARY', 'INTEGRATION_HEALTH', 'EVENT_HEALTH', 'PLATFORM_HEALTH')
  ),
  source_component text NOT NULL CHECK (source_component IN ('CMP-017', 'CMP-029', 'CMP-037', 'CMP-038', 'CMP-047')),
  status text NOT NULL CHECK (status IN ('OK', 'DEGRADED', 'UNAVAILABLE')),
  metrics jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(metrics) = 'array' AND jsonb_array_length(metrics) <= 200
    AND octet_length(metrics::text) <= 262144
  ),
  source_observed_at timestamptz,
  as_of timestamptz,
  last_attempt_at timestamptz NOT NULL,
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  snapshot_version bigint NOT NULL CHECK (snapshot_version >= 1),
  non_authoritative boolean NOT NULL DEFAULT true CHECK (non_authoritative),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, snapshot_id),
  UNIQUE (tenant_id, view_code),
  CHECK (
    (view_code = 'SLA_SUMMARY' AND source_component = 'CMP-029')
    OR (view_code = 'QUEUE_SUMMARY' AND source_component = 'CMP-017')
    OR (view_code = 'INTEGRATION_HEALTH' AND source_component = 'CMP-037')
    OR (view_code = 'EVENT_HEALTH' AND source_component = 'CMP-038')
    OR (view_code = 'PLATFORM_HEALTH' AND source_component = 'CMP-047')
  ),
  CHECK (status = 'UNAVAILABLE' OR as_of IS NOT NULL)
);
ALTER TABLE sf_ops_dashboard.ops_view_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_ops_dashboard.ops_view_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_view_snapshot_isolation ON sf_ops_dashboard.ops_view_snapshot TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_ops_dashboard.ops_view_snapshot OWNER TO sf_migrator;

-- sf:isolation sf_ops_dashboard.ops_view_refresh_log TENANT_SCOPED owner=CMP-046
CREATE TABLE sf_ops_dashboard.ops_view_refresh_log (
  tenant_id uuid NOT NULL,
  refresh_id uuid NOT NULL,
  view_code text NOT NULL CHECK (
    view_code IN ('SLA_SUMMARY', 'QUEUE_SUMMARY', 'INTEGRATION_HEALTH', 'EVENT_HEALTH', 'PLATFORM_HEALTH')
  ),
  outcome text NOT NULL CHECK (outcome IN ('SUCCESS', 'SOURCE_FAILED', 'PAYLOAD_INVALID')),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  resulting_status text NOT NULL CHECK (resulting_status IN ('OK', 'DEGRADED', 'UNAVAILABLE')),
  attempted_at timestamptz NOT NULL,
  actor_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, refresh_id),
  CHECK ((outcome = 'SUCCESS') = (error_code IS NULL))
);
CREATE INDEX ops_view_refresh_log_view_idx
  ON sf_ops_dashboard.ops_view_refresh_log (tenant_id, view_code, attempted_at);
ALTER TABLE sf_ops_dashboard.ops_view_refresh_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_ops_dashboard.ops_view_refresh_log FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_view_refresh_log_isolation ON sf_ops_dashboard.ops_view_refresh_log TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_ops_dashboard.ops_view_refresh_log OWNER TO sf_migrator;

-- sf:isolation sf_ops_dashboard.idempotency_record TENANT_SCOPED owner=CMP-046
CREATE TABLE sf_ops_dashboard.idempotency_record (
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
ALTER TABLE sf_ops_dashboard.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_ops_dashboard.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_ops_dashboard.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_ops_dashboard.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_ops_dashboard.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_ops_dashboard, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'insert-only ops dashboard row' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_ops_dashboard.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER ops_view_refresh_log_immutable
  BEFORE UPDATE OR DELETE ON sf_ops_dashboard.ops_view_refresh_log
  FOR EACH ROW EXECUTE FUNCTION sf_ops_dashboard.reject_mutation();

CREATE FUNCTION sf_ops_dashboard.guard_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_ops_dashboard, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ops view snapshots are replaced, never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id
     OR NEW.view_code IS DISTINCT FROM OLD.view_code
     OR NEW.source_component IS DISTINCT FROM OLD.source_component
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'ops view snapshot identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.snapshot_version <> OLD.snapshot_version + 1 THEN
    RAISE EXCEPTION 'ops view snapshot_version must advance by one';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_ops_dashboard.guard_snapshot() OWNER TO sf_migrator;

CREATE TRIGGER ops_view_snapshot_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_ops_dashboard.ops_view_snapshot
  FOR EACH ROW EXECUTE FUNCTION sf_ops_dashboard.guard_snapshot();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_ops_dashboard FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_ops_dashboard FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_ops_dashboard FROM PUBLIC;

GRANT SELECT, INSERT,
  UPDATE (
    status, metrics, source_observed_at, as_of, last_attempt_at, last_error_code,
    snapshot_version, updated_at
  )
  ON sf_ops_dashboard.ops_view_snapshot TO sf_cmp046_rw;
GRANT SELECT, INSERT ON sf_ops_dashboard.ops_view_refresh_log TO sf_cmp046_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_ops_dashboard.idempotency_record TO sf_cmp046_rw;

GRANT EXECUTE ON FUNCTION sf_ops_dashboard.reject_mutation() TO sf_cmp046_rw;
GRANT EXECUTE ON FUNCTION sf_ops_dashboard.guard_snapshot() TO sf_cmp046_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_ops_dashboard FROM sf_cmp046_rw;
REVOKE ALL ON SCHEMA sf_ops_dashboard FROM sf_app;
DROP SCHEMA IF EXISTS sf_ops_dashboard CASCADE;
-- Role sf_cmp046_rw retained (may be referenced by runtime logins); never DROP ROLE here.
