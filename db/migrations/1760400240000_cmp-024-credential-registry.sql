-- CMP-024 Credential Registry / Revocation (SF-M07-002). ADR-0006 Option A: sf_cmp024_rw NOLOGIN
-- holds DML; FORCE RLS; PUBLIC revoked; runtime is not the table owner (sf_migrator).
-- SF-CON-CREDENTIAL-STATUS: CMP-024 is the only writer of registry status. History rows are
-- insert-only and must match the entry version they record. Suspension/revocation carry an opaque
-- reason_code_ref from tenant metadata; no column encodes statutory grounds. REISSUED requires the
-- successor credential id. REVOKED and REISSUED are terminal.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp024_rw') THEN
    CREATE ROLE sf_cmp024_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp024_rw IS
  'ADR-0006: CMP-024 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_credential_registry AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_credential_registry IS
  'isolation_class=TENANT_SCOPED; owner=CMP-024; authoritative credential status + immutable history';

REVOKE ALL ON SCHEMA sf_credential_registry FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_credential_registry TO sf_cmp024_rw;
GRANT USAGE ON SCHEMA sf_credential_registry TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_credential_registry REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_credential_registry REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_credential_registry REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_credential_registry.credential_registry_entry TENANT_SCOPED owner=CMP-024
CREATE TABLE sf_credential_registry.credential_registry_entry (
  tenant_id uuid NOT NULL,
  credential_id uuid NOT NULL,
  issuer_ref text NOT NULL CHECK (issuer_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  current_status text NOT NULL CHECK (
    current_status IN ('REGISTERED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REISSUED')
  ),
  superseded_by_credential_id uuid,
  status_version bigint NOT NULL CHECK (status_version >= 1),
  registered_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  registered_by uuid NOT NULL,
  last_correlation_id uuid NOT NULL,
  status_authority_cmp text NOT NULL DEFAULT 'CMP-024' CHECK (status_authority_cmp = 'CMP-024'),
  invented_statutory_policy_forbidden boolean NOT NULL DEFAULT true
    CHECK (invented_statutory_policy_forbidden),
  PRIMARY KEY (tenant_id, credential_id),
  CHECK ((current_status = 'REISSUED') = (superseded_by_credential_id IS NOT NULL)),
  CHECK (superseded_by_credential_id IS DISTINCT FROM credential_id),
  CHECK (current_status <> 'REGISTERED' OR status_version = 1)
);
CREATE INDEX credential_registry_entry_status_idx
  ON sf_credential_registry.credential_registry_entry (tenant_id, current_status);
ALTER TABLE sf_credential_registry.credential_registry_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_credential_registry.credential_registry_entry FORCE ROW LEVEL SECURITY;
CREATE POLICY credential_registry_entry_isolation ON sf_credential_registry.credential_registry_entry TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_credential_registry.credential_registry_entry OWNER TO sf_migrator;

-- sf:isolation sf_credential_registry.credential_status_history TENANT_SCOPED owner=CMP-024
CREATE TABLE sf_credential_registry.credential_status_history (
  tenant_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  credential_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 1),
  from_status text CHECK (
    from_status IS NULL OR from_status IN ('REGISTERED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REISSUED')
  ),
  to_status text NOT NULL CHECK (
    to_status IN ('REGISTERED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REISSUED')
  ),
  reason_code_ref text CHECK (reason_code_ref IS NULL OR reason_code_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  superseded_by_credential_id uuid,
  actor_type text NOT NULL CHECK (
    actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')
  ),
  actor_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  changed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  immutable boolean NOT NULL DEFAULT true CHECK (immutable),
  PRIMARY KEY (tenant_id, entry_id),
  UNIQUE (tenant_id, credential_id, sequence),
  FOREIGN KEY (tenant_id, credential_id)
    REFERENCES sf_credential_registry.credential_registry_entry (tenant_id, credential_id),
  CHECK ((sequence = 1) = (from_status IS NULL)),
  CHECK (sequence <> 1 OR to_status = 'REGISTERED'),
  CHECK (from_status IS DISTINCT FROM to_status),
  CHECK (to_status NOT IN ('SUSPENDED', 'REVOKED') OR reason_code_ref IS NOT NULL),
  CHECK ((to_status = 'REISSUED') = (superseded_by_credential_id IS NOT NULL))
);
ALTER TABLE sf_credential_registry.credential_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_credential_registry.credential_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY credential_status_history_isolation ON sf_credential_registry.credential_status_history TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_credential_registry.credential_status_history OWNER TO sf_migrator;

-- sf:isolation sf_credential_registry.idempotency_record TENANT_SCOPED owner=CMP-024
CREATE TABLE sf_credential_registry.idempotency_record (
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
ALTER TABLE sf_credential_registry.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_credential_registry.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_credential_registry.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_credential_registry.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_credential_registry.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_credential_registry, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'credential status history is insert-only' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_credential_registry.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER credential_status_history_immutable
  BEFORE UPDATE OR DELETE ON sf_credential_registry.credential_status_history
  FOR EACH ROW EXECUTE FUNCTION sf_credential_registry.reject_mutation();

-- Lifecycle pairs mirror src/domain/status.ts COMMAND_SOURCES/COMMAND_TARGET.
CREATE FUNCTION sf_credential_registry.guard_entry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_credential_registry, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'registry entries are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.current_status <> 'REGISTERED' OR NEW.status_version <> 1
       OR NEW.superseded_by_credential_id IS NOT NULL THEN
      RAISE EXCEPTION 'a credential enters the registry as REGISTERED at version 1'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.credential_id, NEW.issuer_ref, NEW.registered_at, NEW.registered_by,
      NEW.status_authority_cmp)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.credential_id, OLD.issuer_ref, OLD.registered_at, OLD.registered_by,
      OLD.status_authority_cmp) THEN
    RAISE EXCEPTION 'registry entry identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.current_status IN ('REVOKED', 'REISSUED') THEN
    RAISE EXCEPTION 'terminal registry status cannot change'
      USING ERRCODE = 'P0001', HINT = 'SF_TERMINAL_STATUS';
  END IF;
  IF NEW.status_version <> OLD.status_version + 1 THEN
    RAISE EXCEPTION 'status_version must advance by one'
      USING ERRCODE = 'P0001', HINT = 'SF_STALE_VERSION';
  END IF;
  IF NOT (
       (OLD.current_status = 'REGISTERED' AND NEW.current_status IN ('ACTIVE', 'REVOKED'))
    OR (OLD.current_status = 'ACTIVE' AND NEW.current_status IN ('SUSPENDED', 'REVOKED', 'REISSUED'))
    OR (OLD.current_status = 'SUSPENDED' AND NEW.current_status IN ('ACTIVE', 'REVOKED', 'REISSUED'))
  ) THEN
    RAISE EXCEPTION 'registry status transition not allowed'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_credential_registry.guard_entry() OWNER TO sf_migrator;

CREATE TRIGGER credential_registry_entry_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_credential_registry.credential_registry_entry
  FOR EACH ROW EXECUTE FUNCTION sf_credential_registry.guard_entry();

-- A history row records exactly the entry state written in the same transaction.
CREATE FUNCTION sf_credential_registry.guard_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_credential_registry, pg_temp
AS $$
DECLARE
  cur record;
BEGIN
  SELECT current_status, status_version, superseded_by_credential_id INTO cur
    FROM sf_credential_registry.credential_registry_entry
   WHERE tenant_id = NEW.tenant_id AND credential_id = NEW.credential_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'history requires a registry entry' USING ERRCODE = '23503';
  END IF;
  IF NEW.sequence <> cur.status_version OR NEW.to_status <> cur.current_status
     OR NEW.superseded_by_credential_id IS DISTINCT FROM cur.superseded_by_credential_id THEN
    RAISE EXCEPTION 'history row does not match the registry entry'
      USING ERRCODE = 'P0001', HINT = 'SF_HISTORY_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_credential_registry.guard_history() OWNER TO sf_migrator;

CREATE TRIGGER credential_status_history_guard
  BEFORE INSERT ON sf_credential_registry.credential_status_history
  FOR EACH ROW EXECUTE FUNCTION sf_credential_registry.guard_history();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_credential_registry FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_credential_registry FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_credential_registry FROM PUBLIC;

GRANT SELECT, INSERT,
  UPDATE (current_status, superseded_by_credential_id, status_version, updated_at, last_correlation_id)
  ON sf_credential_registry.credential_registry_entry TO sf_cmp024_rw;
GRANT SELECT, INSERT ON sf_credential_registry.credential_status_history TO sf_cmp024_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_credential_registry.idempotency_record TO sf_cmp024_rw;

GRANT EXECUTE ON FUNCTION sf_credential_registry.reject_mutation() TO sf_cmp024_rw;
GRANT EXECUTE ON FUNCTION sf_credential_registry.guard_entry() TO sf_cmp024_rw;
GRANT EXECUTE ON FUNCTION sf_credential_registry.guard_history() TO sf_cmp024_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_credential_registry FROM sf_cmp024_rw;
REVOKE ALL ON SCHEMA sf_credential_registry FROM sf_app;
DROP SCHEMA IF EXISTS sf_credential_registry CASCADE;
-- Role sf_cmp024_rw retained (may be referenced by runtime logins); never DROP ROLE here.
