-- CMP-023 QR Verification Service (SF-M07-003). ADR-0006 Option A: sf_cmp023_rw NOLOGIN holds DML;
-- FORCE RLS; PUBLIC revoked; runtime is not the table owner (sf_migrator).
-- Stores CMP-023's own opaque verification tokens (SF-CON-VERIFICATION-TOKEN) only. Registry status
-- is owned by CMP-024 and read live through a port on every verification: there is deliberately no
-- status column here, so CMP-023 cannot write, cache or override it. Rows carry opaque metadata refs
-- and hashes only; no holder identity or application data. Token rows are insert-only.
-- No validity or retention period is defined here; expires_at is set only when the issuing caller
-- supplies one from approved metadata, and row retention is owner input via CMP-049.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp023_rw') THEN
    CREATE ROLE sf_cmp023_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp023_rw IS
  'ADR-0006: CMP-023 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_qr AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_qr IS
  'isolation_class=TENANT_SCOPED; owner=CMP-023; opaque QR verification tokens (no registry status, no PII)';

REVOKE ALL ON SCHEMA sf_qr FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_qr TO sf_cmp023_rw;
GRANT USAGE ON SCHEMA sf_qr TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_qr REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_qr REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_qr REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_qr.verification_token TENANT_SCOPED owner=CMP-023
CREATE TABLE sf_qr.verification_token (
  tenant_id uuid NOT NULL,
  token_id uuid NOT NULL,
  credential_id uuid NOT NULL,
  contract_id text NOT NULL DEFAULT 'SF-CON-VERIFICATION-TOKEN'
    CHECK (contract_id = 'SF-CON-VERIFICATION-TOKEN'),
  opaque_token text NOT NULL CHECK (
    opaque_token ~ '^[A-Za-z0-9_-]+$' AND char_length(opaque_token) BETWEEN 22 AND 256
  ),
  token_purpose text NOT NULL DEFAULT 'PUBLIC_CREDENTIAL_VERIFICATION'
    CHECK (token_purpose = 'PUBLIC_CREDENTIAL_VERIFICATION'),
  credential_type_ref text NOT NULL CHECK (credential_type_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  issuer_ref text NOT NULL CHECK (issuer_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  issued_at timestamptz,
  signed_artifact_sha256 text CHECK (
    signed_artifact_sha256 IS NULL OR signed_artifact_sha256 ~ '^[a-f0-9]{64}$'
  ),
  status_source_cmp text NOT NULL DEFAULT 'CMP-024' CHECK (status_source_cmp = 'CMP-024'),
  registry_status_read_only boolean NOT NULL DEFAULT true CHECK (registry_status_read_only),
  status_write_forbidden boolean NOT NULL DEFAULT true CHECK (status_write_forbidden),
  embedded_pii_forbidden boolean NOT NULL DEFAULT true CHECK (embedded_pii_forbidden),
  expires_at timestamptz,
  actor_type text NOT NULL CHECK (actor_type IN ('OFFICER', 'PRIVILEGED_ADMIN', 'SYSTEM')),
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, token_id),
  UNIQUE (tenant_id, opaque_token),
  UNIQUE (tenant_id, credential_id, token_purpose),
  CHECK (expires_at IS NULL OR expires_at > created_at)
);
ALTER TABLE sf_qr.verification_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_qr.verification_token FORCE ROW LEVEL SECURITY;
CREATE POLICY verification_token_isolation ON sf_qr.verification_token TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_qr.verification_token OWNER TO sf_migrator;

-- sf:isolation sf_qr.idempotency_record TENANT_SCOPED owner=CMP-023
CREATE TABLE sf_qr.idempotency_record (
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
ALTER TABLE sf_qr.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_qr.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_qr.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_qr.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_qr.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_qr, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'insert-only verification token row' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_qr.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER verification_token_immutable
  BEFORE UPDATE OR DELETE ON sf_qr.verification_token
  FOR EACH ROW EXECUTE FUNCTION sf_qr.reject_mutation();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_qr FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_qr FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_qr FROM PUBLIC;

GRANT SELECT, INSERT ON sf_qr.verification_token TO sf_cmp023_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_qr.idempotency_record TO sf_cmp023_rw;

GRANT EXECUTE ON FUNCTION sf_qr.reject_mutation() TO sf_cmp023_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_qr FROM sf_cmp023_rw;
REVOKE ALL ON SCHEMA sf_qr FROM sf_app;
DROP SCHEMA IF EXISTS sf_qr CASCADE;
-- Role sf_cmp023_rw retained (may be referenced by runtime logins); never DROP ROLE here.
