-- ServiceForm AI CMP-005 Citizen Profile schema (ADR-0006 Option A).
-- Schema sf_citizen_profile owned by sf_migrator. DML via sf_cmp005_rw. RLS policies TO sf_app.
-- Platform profile + verified-claim provenance only. No statutory field vocabulary.

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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp005_rw') THEN
    CREATE ROLE sf_cmp005_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp005_rw IS 'CMP-005 privilege role (ADR-0006). NOLOGIN. Holds DML on sf_citizen_profile business tables.';

CREATE SCHEMA sf_citizen_profile AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_citizen_profile IS 'isolation_class=mixed; owner=CMP-005; Citizen profile and verified-claim provenance';

REVOKE ALL ON SCHEMA sf_citizen_profile FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_citizen_profile TO sf_cmp005_rw;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_citizen_profile REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_citizen_profile REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_citizen_profile REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- sf:isolation sf_citizen_profile.claim_definition GLOBAL owner=CMP-005
CREATE TABLE sf_citizen_profile.claim_definition (
  section_code text NOT NULL CHECK (section_code IN ('IDENTITY', 'ADDRESS', 'FAMILY', 'OCCUPATION')),
  claim_code text NOT NULL CHECK (claim_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  value_kind text NOT NULL CHECK (value_kind IN ('STRING')),
  PRIMARY KEY (section_code, claim_code)
);
ALTER TABLE sf_citizen_profile.claim_definition OWNER TO sf_migrator;
INSERT INTO sf_citizen_profile.claim_definition (section_code, claim_code, value_kind) VALUES
  ('IDENTITY', 'DISPLAY_NAME', 'STRING'),
  ('IDENTITY', 'GIVEN_NAME', 'STRING'),
  ('IDENTITY', 'FAMILY_NAME', 'STRING'),
  ('IDENTITY', 'CONTACT_EMAIL', 'STRING'),
  ('IDENTITY', 'CONTACT_PHONE', 'STRING'),
  ('ADDRESS', 'ADDRESS_LINE', 'STRING'),
  ('ADDRESS', 'LOCALITY', 'STRING'),
  ('ADDRESS', 'ADMIN_AREA', 'STRING'),
  ('ADDRESS', 'POSTAL_CODE', 'STRING'),
  ('ADDRESS', 'COUNTRY_CODE', 'STRING'),
  ('FAMILY', 'MEMBER_DISPLAY_NAME', 'STRING'),
  ('OCCUPATION', 'OCCUPATION_TITLE', 'STRING'),
  ('OCCUPATION', 'EMPLOYER_NAME', 'STRING');

-- sf:isolation sf_citizen_profile.citizen_profile CITIZEN_PRIVATE owner=CMP-005
CREATE TABLE sf_citizen_profile.citizen_profile (
  tenant_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE')),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, profile_id),
  UNIQUE (tenant_id, subject_id)
);
ALTER TABLE sf_citizen_profile.citizen_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_citizen_profile.citizen_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY citizen_profile_isolation ON sf_citizen_profile.citizen_profile TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_citizen_profile.citizen_profile OWNER TO sf_migrator;

-- sf:isolation sf_citizen_profile.profile_claim CITIZEN_PRIVATE owner=CMP-005
CREATE TABLE sf_citizen_profile.profile_claim (
  tenant_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  section_code text NOT NULL CHECK (section_code IN ('IDENTITY', 'ADDRESS', 'FAMILY', 'OCCUPATION')),
  claim_code text NOT NULL CHECK (claim_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  value_sha256 text NOT NULL CHECK (value_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  value_text text NOT NULL CHECK (char_length(value_text) BETWEEN 1 AND 500),
  source_kind text NOT NULL CHECK (source_kind IN ('SELF', 'OFFICER', 'CONNECTOR')),
  connector_type text CHECK (connector_type IS NULL OR connector_type = 'DIGILOCKER'),
  verification_status text NOT NULL CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED', 'STALE', 'REVOKED')),
  purpose_code text NOT NULL CHECK (purpose_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  source_ref text CHECK (source_ref IS NULL OR char_length(source_ref) BETWEEN 1 AND 200),
  verified_at timestamptz,
  expires_at timestamptz,
  simulation jsonb,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, claim_id),
  UNIQUE (tenant_id, profile_id, section_code, claim_code),
  FOREIGN KEY (tenant_id, profile_id) REFERENCES sf_citizen_profile.citizen_profile (tenant_id, profile_id),
  FOREIGN KEY (section_code, claim_code) REFERENCES sf_citizen_profile.claim_definition (section_code, claim_code),
  CHECK (
    (source_kind = 'CONNECTOR' AND connector_type IS NOT NULL)
    OR (source_kind <> 'CONNECTOR' AND connector_type IS NULL)
  ),
  CHECK (
    (verification_status = 'VERIFIED' AND verified_at IS NOT NULL)
    OR (verification_status <> 'VERIFIED' AND verified_at IS NULL)
  ),
  CHECK (simulation IS NULL OR (simulation ->> 'simulation') = 'true')
);
CREATE INDEX profile_claim_subject_idx
  ON sf_citizen_profile.profile_claim (tenant_id, subject_id, section_code);
ALTER TABLE sf_citizen_profile.profile_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_citizen_profile.profile_claim FORCE ROW LEVEL SECURITY;
CREATE POLICY profile_claim_isolation ON sf_citizen_profile.profile_claim TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_citizen_profile.profile_claim OWNER TO sf_migrator;

-- sf:isolation sf_citizen_profile.idempotency_record TENANT_SCOPED owner=CMP-005
CREATE TABLE sf_citizen_profile.idempotency_record (
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
ALTER TABLE sf_citizen_profile.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_citizen_profile.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_citizen_profile.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_citizen_profile.idempotency_record OWNER TO sf_migrator;

-- sf:isolation sf_citizen_profile.idempotency_record_platform PLATFORM_OPERATIONAL owner=CMP-005
CREATE TABLE sf_citizen_profile.idempotency_record_platform (
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
ALTER TABLE sf_citizen_profile.idempotency_record_platform ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_citizen_profile.idempotency_record_platform FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_platform_actor ON sf_citizen_profile.idempotency_record_platform TO sf_app
  USING (principal_id = sf_platform.current_actor_id())
  WITH CHECK (principal_id = sf_platform.current_actor_id());
ALTER TABLE sf_citizen_profile.idempotency_record_platform OWNER TO sf_migrator;

CREATE FUNCTION sf_citizen_profile.enforce_verified_claim_machine()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_citizen_profile, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'profile claim delete is not permitted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR OLD.claim_id IS DISTINCT FROM NEW.claim_id
       OR OLD.profile_id IS DISTINCT FROM NEW.profile_id
       OR OLD.subject_id IS DISTINCT FROM NEW.subject_id
       OR OLD.section_code IS DISTINCT FROM NEW.section_code
       OR OLD.claim_code IS DISTINCT FROM NEW.claim_code THEN
      RAISE EXCEPTION 'profile claim identity fields are immutable' USING ERRCODE = '42501';
    END IF;
    IF OLD.verification_status = 'VERIFIED'
       AND NEW.verification_status = 'UNVERIFIED' THEN
      RAISE EXCEPTION 'verified claim cannot be downgraded to UNVERIFIED' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profile_claim_machine
  BEFORE INSERT OR UPDATE OR DELETE ON sf_citizen_profile.profile_claim
  FOR EACH ROW
  EXECUTE FUNCTION sf_citizen_profile.enforce_verified_claim_machine();
ALTER FUNCTION sf_citizen_profile.enforce_verified_claim_machine() OWNER TO sf_migrator;

REVOKE ALL ON ALL TABLES IN SCHEMA sf_citizen_profile FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_citizen_profile FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_citizen_profile FROM PUBLIC;

GRANT SELECT ON sf_citizen_profile.claim_definition TO sf_cmp005_rw;
GRANT SELECT, INSERT, UPDATE (status, version, updated_at) ON sf_citizen_profile.citizen_profile TO sf_cmp005_rw;
GRANT SELECT, INSERT, UPDATE (
  value_sha256, value_text, source_kind, connector_type, verification_status,
  purpose_code, source_ref, verified_at, expires_at, simulation, version, updated_at
) ON sf_citizen_profile.profile_claim TO sf_cmp005_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_citizen_profile.idempotency_record TO sf_cmp005_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_citizen_profile.idempotency_record_platform TO sf_cmp005_rw;
GRANT EXECUTE ON FUNCTION sf_citizen_profile.enforce_verified_claim_machine() TO sf_cmp005_rw;

ALTER TABLE sf_citizen_profile.profile_claim ALTER COLUMN value_text SET STATISTICS 0;

-- Down Migration
REVOKE ALL ON SCHEMA sf_citizen_profile FROM sf_cmp005_rw;
DROP SCHEMA IF EXISTS sf_citizen_profile CASCADE;
DROP ROLE IF EXISTS sf_cmp005_rw;
