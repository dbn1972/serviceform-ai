-- ServiceForm AI CMP-004 Identity & Access schema (ADR-0006 Option A).
-- Schema sf_identity owned by sf_migrator. DML via sf_cmp004_rw. RLS policies TO sf_app.
-- Officer/session tables are TENANT_SCOPED (INT-011). Citizen identity is CITIZEN_PRIVATE
-- (immutable citizen_id; tenant_id is not client-supplied). No FK to other component schemas.

-- Up Migration

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_migrator') THEN
    CREATE ROLE sf_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_migrator IS 'Deployment/migration role. Owns authoritative schemas/tables. Never a runtime login.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp004_rw') THEN
    CREATE ROLE sf_cmp004_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp004_rw IS 'CMP-004 privilege role (ADR-0006). NOLOGIN. Holds DML on sf_identity business tables.';

CREATE SCHEMA sf_identity AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_identity IS 'isolation_class=mixed; owner=CMP-004; Identity and access';

REVOKE ALL ON SCHEMA sf_identity FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_identity TO sf_cmp004_rw;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_identity REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_identity REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_identity REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- sf:isolation sf_identity.citizen_principal CITIZEN_PRIVATE owner=CMP-004
CREATE TABLE sf_identity.citizen_principal (
  citizen_id uuid NOT NULL PRIMARY KEY,
  channel_hash text NOT NULL UNIQUE CHECK (channel_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'LOCKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sf_identity.citizen_principal OWNER TO sf_migrator;

-- sf:isolation sf_identity.citizen_otp_challenge CITIZEN_PRIVATE owner=CMP-004
CREATE TABLE sf_identity.citizen_otp_challenge (
  challenge_id uuid NOT NULL PRIMARY KEY,
  citizen_id uuid NOT NULL REFERENCES sf_identity.citizen_principal (citizen_id),
  channel_hash text NOT NULL CHECK (channel_hash ~ '^[0-9a-f]{64}$'),
  purpose text NOT NULL CHECK (purpose IN ('AUTH', 'RECOVERY')),
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('PENDING', 'VERIFIED', 'EXPIRED', 'LOCKED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  expires_at timestamptz NOT NULL,
  simulation jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX citizen_otp_challenge_citizen_idx ON sf_identity.citizen_otp_challenge (citizen_id, created_at DESC);
ALTER TABLE sf_identity.citizen_otp_challenge OWNER TO sf_migrator;

-- sf:isolation sf_identity.citizen_session CITIZEN_PRIVATE owner=CMP-004
CREATE TABLE sf_identity.citizen_session (
  session_id uuid NOT NULL PRIMARY KEY,
  citizen_id uuid NOT NULL REFERENCES sf_identity.citizen_principal (citizen_id),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  assurance text NOT NULL CHECK (assurance IN ('OTP', 'MFA')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX citizen_session_citizen_idx ON sf_identity.citizen_session (citizen_id, created_at DESC);
ALTER TABLE sf_identity.citizen_session OWNER TO sf_migrator;

-- sf:isolation sf_identity.identity_link CITIZEN_PRIVATE owner=CMP-004
CREATE TABLE sf_identity.identity_link (
  link_id uuid NOT NULL PRIMARY KEY,
  citizen_id uuid NOT NULL REFERENCES sf_identity.citizen_principal (citizen_id),
  method text NOT NULL CHECK (method IN ('OTP', 'DIGILOCKER', 'IDP')),
  subject_hash text NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  simulation jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (citizen_id, method, subject_hash)
);
ALTER TABLE sf_identity.identity_link OWNER TO sf_migrator;

-- sf:isolation sf_identity.account_recovery CITIZEN_PRIVATE owner=CMP-004
CREATE TABLE sf_identity.account_recovery (
  recovery_id uuid NOT NULL PRIMARY KEY,
  citizen_id uuid NOT NULL REFERENCES sf_identity.citizen_principal (citizen_id),
  challenge_id uuid NOT NULL REFERENCES sf_identity.citizen_otp_challenge (challenge_id),
  status text NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'EXPIRED', 'CANCELLED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE sf_identity.account_recovery OWNER TO sf_migrator;

-- sf:isolation sf_identity.session_lookup PLATFORM_OPERATIONAL owner=CMP-004
CREATE TABLE sf_identity.session_lookup (
  token_hash text NOT NULL PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  session_id uuid NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('CITIZEN', 'OFFICER')),
  subject_id uuid NOT NULL,
  tenant_id uuid,
  assurance text NOT NULL CHECK (assurance IN ('OTP', 'PASSWORD', 'MFA', 'WORKLOAD_IDENTITY')),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  expires_at timestamptz NOT NULL,
  CHECK (
    (actor_type = 'CITIZEN' AND tenant_id IS NULL)
    OR (actor_type = 'OFFICER' AND tenant_id IS NOT NULL)
  )
);
ALTER TABLE sf_identity.session_lookup OWNER TO sf_migrator;

-- sf:isolation sf_identity.officer_principal TENANT_SCOPED owner=CMP-004
CREATE TABLE sf_identity.officer_principal (
  tenant_id uuid NOT NULL,
  officer_id uuid NOT NULL,
  idp_subject_hash text NOT NULL CHECK (idp_subject_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  organisation_id uuid,
  office_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, officer_id),
  UNIQUE (tenant_id, idp_subject_hash)
);
ALTER TABLE sf_identity.officer_principal ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_identity.officer_principal FORCE ROW LEVEL SECURITY;
CREATE POLICY officer_principal_isolation ON sf_identity.officer_principal TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_identity.officer_principal OWNER TO sf_migrator;

-- sf:isolation sf_identity.officer_session TENANT_SCOPED owner=CMP-004
CREATE TABLE sf_identity.officer_session (
  tenant_id uuid NOT NULL,
  session_id uuid NOT NULL,
  officer_id uuid NOT NULL,
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  assurance text NOT NULL CHECK (assurance IN ('PASSWORD', 'MFA', 'WORKLOAD_IDENTITY')),
  role_codes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, session_id),
  UNIQUE (tenant_id, token_hash),
  FOREIGN KEY (tenant_id, officer_id) REFERENCES sf_identity.officer_principal (tenant_id, officer_id)
);
CREATE INDEX officer_session_officer_idx ON sf_identity.officer_session (tenant_id, officer_id, created_at DESC);
ALTER TABLE sf_identity.officer_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_identity.officer_session FORCE ROW LEVEL SECURITY;
CREATE POLICY officer_session_isolation ON sf_identity.officer_session TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_identity.officer_session OWNER TO sf_migrator;

-- sf:isolation sf_identity.idempotency_record TENANT_SCOPED owner=CMP-004
CREATE TABLE sf_identity.idempotency_record (
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
ALTER TABLE sf_identity.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_identity.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_identity.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_identity.idempotency_record OWNER TO sf_migrator;

-- sf:isolation sf_identity.idempotency_record_platform PLATFORM_OPERATIONAL owner=CMP-004
CREATE TABLE sf_identity.idempotency_record_platform (
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
  PRIMARY KEY (principal_id, endpoint, idempotency_key)
);
ALTER TABLE sf_identity.idempotency_record_platform OWNER TO sf_migrator;

REVOKE ALL ON ALL TABLES IN SCHEMA sf_identity FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_identity FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_identity FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE (status, updated_at) ON sf_identity.citizen_principal TO sf_cmp004_rw;
GRANT SELECT, INSERT, UPDATE (status, attempts) ON sf_identity.citizen_otp_challenge TO sf_cmp004_rw;
GRANT SELECT, INSERT, UPDATE (status, revoked_at) ON sf_identity.citizen_session TO sf_cmp004_rw;
GRANT SELECT, INSERT, UPDATE (status) ON sf_identity.identity_link TO sf_cmp004_rw;
GRANT SELECT, INSERT, UPDATE (status, completed_at) ON sf_identity.account_recovery TO sf_cmp004_rw;
GRANT SELECT, INSERT, UPDATE (status) ON sf_identity.session_lookup TO sf_cmp004_rw;
GRANT SELECT, INSERT, UPDATE (status, organisation_id, office_id, updated_at) ON sf_identity.officer_principal TO sf_cmp004_rw;
GRANT SELECT, INSERT, UPDATE (status, revoked_at) ON sf_identity.officer_session TO sf_cmp004_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body) ON sf_identity.idempotency_record TO sf_cmp004_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body) ON sf_identity.idempotency_record_platform TO sf_cmp004_rw;

ALTER TABLE sf_identity.officer_principal ALTER COLUMN idp_subject_hash SET STATISTICS 0;
ALTER TABLE sf_identity.officer_session ALTER COLUMN token_hash SET STATISTICS 0;

-- Down Migration
REVOKE ALL ON SCHEMA sf_identity FROM sf_cmp004_rw;
DROP SCHEMA IF EXISTS sf_identity CASCADE;
DROP ROLE IF EXISTS sf_cmp004_rw;
