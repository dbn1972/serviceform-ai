-- CMP-012 DigiLocker Connector (SF-M07-004). ADR-0006 Option A: sf_cmp012_rw NOLOGIN holds DML;
-- FORCE RLS; PUBLIC revoked; runtime is not the table owner (sf_migrator).
-- DigiLocker publish records and idempotency only. Publish failure MUST NOT reverse, void or
-- alter credential issuance or registry status. Provider secrets are never stored here:
-- connector_binding_id is a foreign reference to CMP-037. Network calls happen outside any DB
-- transaction. Issuance-reversed and registry-changed invariants are enforced as CHECK constraints.
-- This migration grants no privilege on peer component schemas.
-- No invented DigiLocker/eSign statutory policy.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp012_rw') THEN
    CREATE ROLE sf_cmp012_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp012_rw IS
  'ADR-0006: CMP-012 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_digilocker AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_digilocker IS
  'isolation_class=TENANT_SCOPED; owner=CMP-012; DigiLocker publish records and idempotency';

REVOKE ALL ON SCHEMA sf_digilocker FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_digilocker TO sf_cmp012_rw;
GRANT USAGE ON SCHEMA sf_digilocker TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_digilocker REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_digilocker REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_digilocker REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_digilocker.publish_record TENANT_SCOPED owner=CMP-012
CREATE TABLE sf_digilocker.publish_record (
  tenant_id uuid NOT NULL,
  publish_request_id uuid NOT NULL,
  credential_id uuid NOT NULL,
  credential_lifecycle_status_at_request text NOT NULL
    CHECK (credential_lifecycle_status_at_request = 'ISSUED'),
  consent_ref uuid NOT NULL,
  purpose_code text NOT NULL CHECK (purpose_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  connector_binding_id uuid NOT NULL,
  connector_mode text NOT NULL CHECK (connector_mode IN ('REAL', 'SANDBOX', 'SIMULATED')),
  simulation_marker jsonb,
  document_type_ref text NOT NULL
    CHECK (document_type_ref ~ '^[A-Za-z0-9_.:-]+$' AND char_length(document_type_ref) BETWEEN 1 AND 128),
  publish_status text NOT NULL
    CHECK (publish_status IN ('PENDING', 'PUBLISHED', 'FAILED', 'RETRY_SCHEDULED')),
  provider_transaction_ref text
    CHECK (provider_transaction_ref IS NULL OR
           (provider_transaction_ref ~ '^[A-Za-z0-9_.:-]+$' AND
            char_length(provider_transaction_ref) BETWEEN 1 AND 128)),
  failure_code text
    CHECK (failure_code IS NULL OR failure_code ~ '^SF-(AUTH|TEN|FORM|RULE|APP|EVD|PAY|WF|CRED|INT|RATE|AI|SYS)-[0-9]{3}$'),
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  idempotency_key text NOT NULL
    CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  issuance_reversed_on_publish_failure boolean NOT NULL DEFAULT false
    CHECK (issuance_reversed_on_publish_failure = false),
  registry_status_changed_by_publish boolean NOT NULL DEFAULT false
    CHECK (registry_status_changed_by_publish = false),
  invented_statutory_policy_forbidden boolean NOT NULL DEFAULT true
    CHECK (invented_statutory_policy_forbidden = true),
  correlation_id uuid NOT NULL,
  actor_type text NOT NULL
    CHECK (actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, publish_request_id),
  CONSTRAINT simulation_marker_required_when_simulated CHECK (
    connector_mode <> 'SIMULATED' OR simulation_marker IS NOT NULL
  ),
  CONSTRAINT simulation_marker_forbidden_when_not_simulated CHECK (
    connector_mode = 'SIMULATED' OR simulation_marker IS NULL
  ),
  CONSTRAINT provider_ref_required_when_published CHECK (
    publish_status <> 'PUBLISHED' OR provider_transaction_ref IS NOT NULL
  ),
  CONSTRAINT failure_code_required_when_failed CHECK (
    publish_status NOT IN ('FAILED', 'RETRY_SCHEDULED') OR failure_code IS NOT NULL
  )
);
CREATE INDEX publish_record_credential_idx
  ON sf_digilocker.publish_record (tenant_id, credential_id);
CREATE INDEX publish_record_status_idx
  ON sf_digilocker.publish_record (tenant_id, publish_status)
  WHERE publish_status IN ('PENDING', 'RETRY_SCHEDULED');
ALTER TABLE sf_digilocker.publish_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_digilocker.publish_record FORCE ROW LEVEL SECURITY;
CREATE POLICY publish_record_isolation ON sf_digilocker.publish_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_digilocker.publish_record OWNER TO sf_migrator;

-- sf:isolation sf_digilocker.idempotency_record TENANT_SCOPED owner=CMP-012
CREATE TABLE sf_digilocker.idempotency_record (
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
ALTER TABLE sf_digilocker.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_digilocker.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_digilocker.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_digilocker.idempotency_record OWNER TO sf_migrator;

REVOKE ALL ON ALL TABLES IN SCHEMA sf_digilocker FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_digilocker FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_digilocker FROM PUBLIC;

GRANT SELECT, INSERT ON sf_digilocker.publish_record TO sf_cmp012_rw;
GRANT UPDATE (publish_status, provider_transaction_ref, failure_code, attempt_number, updated_at)
  ON sf_digilocker.publish_record TO sf_cmp012_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_digilocker.idempotency_record TO sf_cmp012_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_digilocker FROM sf_cmp012_rw;
REVOKE ALL ON SCHEMA sf_digilocker FROM sf_app;
DROP SCHEMA IF EXISTS sf_digilocker CASCADE;
-- Role sf_cmp012_rw retained; never DROP ROLE here.
