-- CMP-022 Certificate / Credential Engine (SF-M07-001). ADR-0006 Option A: sf_cmp022_rw NOLOGIN
-- holds DML; FORCE RLS; PUBLIC revoked; runtime is not the table owner (sf_migrator).
-- CMP-022 owns the issuance record (SF-CON-CREDENTIAL), its artifact hash references, its signing
-- attempts (SF-CON-SIGNING-RECORD) and post-issuance downstream outcomes. It stores no artifact
-- bytes, no template content, no approval decision and no registry status (CMP-024 owns status).
-- The lifecycle is forward-only GENERATED -> SIGNED -> ISSUED; ISSUED is terminal and cannot be
-- reversed by any publish or notification outcome. This migration grants nothing on peer schemas.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp022_rw') THEN
    CREATE ROLE sf_cmp022_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp022_rw IS
  'ADR-0006: CMP-022 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_credential AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_credential IS
  'isolation_class=TENANT_SCOPED; owner=CMP-022; credential issuance records, artifact refs, signing attempts';

REVOKE ALL ON SCHEMA sf_credential FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_credential TO sf_cmp022_rw;
GRANT USAGE ON SCHEMA sf_credential TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_credential REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_credential REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_credential REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_credential.credential TENANT_SCOPED owner=CMP-022
CREATE TABLE sf_credential.credential (
  tenant_id uuid NOT NULL,
  credential_id uuid NOT NULL,
  application_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  tenant_service_binding_id uuid NOT NULL,
  service_version_id uuid NOT NULL,
  credential_template_id uuid NOT NULL,
  credential_template_version integer NOT NULL CHECK (credential_template_version >= 1),
  lifecycle_status text NOT NULL CHECK (lifecycle_status IN ('GENERATED', 'SIGNED', 'ISSUED')),
  issuance_key text NOT NULL CHECK (issuance_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  approval_decision_ref text NOT NULL CHECK (approval_decision_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  approval_decision_by_this_component boolean NOT NULL DEFAULT false
    CHECK (approval_decision_by_this_component = false),
  signing_record_id uuid,
  correlation_id uuid NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  created_by uuid NOT NULL,
  generated_at timestamptz NOT NULL,
  signed_at timestamptz,
  issued_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, credential_id),
  UNIQUE (tenant_id, application_id, issuance_key),
  CHECK ((lifecycle_status = 'GENERATED') = (signing_record_id IS NULL)),
  CHECK ((signing_record_id IS NULL) = (signed_at IS NULL)),
  CHECK ((lifecycle_status = 'ISSUED') = (issued_at IS NOT NULL))
);
CREATE INDEX credential_application_idx ON sf_credential.credential (tenant_id, application_id, generated_at);
ALTER TABLE sf_credential.credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_credential.credential FORCE ROW LEVEL SECURITY;
CREATE POLICY credential_isolation ON sf_credential.credential TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_credential.credential OWNER TO sf_migrator;

-- sf:isolation sf_credential.credential_artifact TENANT_SCOPED owner=CMP-022
CREATE TABLE sf_credential.credential_artifact (
  tenant_id uuid NOT NULL,
  credential_id uuid NOT NULL,
  artifact_kind text NOT NULL CHECK (artifact_kind IN ('UNSIGNED_RENDER', 'SIGNED_ARTIFACT')),
  storage_key text NOT NULL CHECK (char_length(storage_key) BETWEEN 1 AND 512 AND storage_key ~ '^[A-Za-z0-9_./:-]+$'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, credential_id, artifact_kind),
  FOREIGN KEY (tenant_id, credential_id) REFERENCES sf_credential.credential (tenant_id, credential_id)
);
ALTER TABLE sf_credential.credential_artifact ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_credential.credential_artifact FORCE ROW LEVEL SECURITY;
CREATE POLICY credential_artifact_isolation ON sf_credential.credential_artifact TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_credential.credential_artifact OWNER TO sf_migrator;

-- sf:isolation sf_credential.signing_record TENANT_SCOPED owner=CMP-022
CREATE TABLE sf_credential.signing_record (
  tenant_id uuid NOT NULL,
  signing_record_id uuid NOT NULL,
  credential_id uuid NOT NULL,
  connector_binding_id uuid NOT NULL,
  integration_contract text NOT NULL DEFAULT 'INT-013' CHECK (integration_contract = 'INT-013'),
  connector_mode text NOT NULL CHECK (connector_mode IN ('REAL', 'SANDBOX', 'SIMULATED')),
  simulation_marker jsonb,
  signing_result text NOT NULL CHECK (signing_result IN ('SIGNED', 'FAILED')),
  signature_ref text CHECK (signature_ref IS NULL OR (char_length(signature_ref) BETWEEN 1 AND 512 AND signature_ref ~ '^[A-Za-z0-9_./:-]+$')),
  signed_artifact_sha256 text CHECK (signed_artifact_sha256 IS NULL OR signed_artifact_sha256 ~ '^[a-f0-9]{64}$'),
  provider_transaction_ref text CHECK (provider_transaction_ref IS NULL OR provider_transaction_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^SF-(AUTH|TEN|FORM|RULE|APP|EVD|PAY|WF|CRED|INT|RATE|AI|SYS)-[0-9]{3}$'),
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  correlation_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, signing_record_id),
  UNIQUE (tenant_id, signing_record_id, credential_id),
  UNIQUE (tenant_id, credential_id, attempt_number),
  FOREIGN KEY (tenant_id, credential_id) REFERENCES sf_credential.credential (tenant_id, credential_id),
  CHECK ((connector_mode = 'SIMULATED') = (simulation_marker IS NOT NULL)),
  CHECK (
    simulation_marker IS NULL OR (
      jsonb_typeof(simulation_marker) = 'object'
      AND simulation_marker -> 'simulation' = 'true'::jsonb
      AND simulation_marker ->> 'connector_binding_id' = connector_binding_id::text
      AND simulation_marker ->> 'environment' IN ('LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE')
    )
  ),
  CHECK (
    (signing_result = 'SIGNED' AND signature_ref IS NOT NULL AND signed_artifact_sha256 IS NOT NULL AND failure_code IS NULL)
    OR (signing_result = 'FAILED' AND failure_code IS NOT NULL AND signature_ref IS NULL AND signed_artifact_sha256 IS NULL)
  )
);
ALTER TABLE sf_credential.signing_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_credential.signing_record FORCE ROW LEVEL SECURITY;
CREATE POLICY signing_record_isolation ON sf_credential.signing_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_credential.signing_record OWNER TO sf_migrator;

-- A credential may only reference a signing record of the same credential.
ALTER TABLE sf_credential.credential
  ADD CONSTRAINT credential_signing_record_fk
  FOREIGN KEY (tenant_id, signing_record_id, credential_id)
  REFERENCES sf_credential.signing_record (tenant_id, signing_record_id, credential_id);

-- sf:isolation sf_credential.downstream_outcome TENANT_SCOPED owner=CMP-022
CREATE TABLE sf_credential.downstream_outcome (
  tenant_id uuid NOT NULL,
  outcome_id uuid NOT NULL,
  credential_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('DIGILOCKER_PUBLISH', 'NOTIFICATION')),
  outcome text NOT NULL CHECK (outcome IN ('SUCCEEDED', 'FAILED')),
  outcome_ref text NOT NULL CHECK (outcome_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^SF-(AUTH|TEN|FORM|RULE|APP|EVD|PAY|WF|CRED|INT|RATE|AI|SYS)-[0-9]{3}$'),
  actor_type text NOT NULL CHECK (actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  recorded_by uuid NOT NULL,
  correlation_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, outcome_id),
  UNIQUE (tenant_id, credential_id, channel, outcome_ref),
  FOREIGN KEY (tenant_id, credential_id) REFERENCES sf_credential.credential (tenant_id, credential_id),
  CHECK ((outcome = 'FAILED') = (failure_code IS NOT NULL))
);
ALTER TABLE sf_credential.downstream_outcome ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_credential.downstream_outcome FORCE ROW LEVEL SECURITY;
CREATE POLICY downstream_outcome_isolation ON sf_credential.downstream_outcome TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_credential.downstream_outcome OWNER TO sf_migrator;

-- sf:isolation sf_credential.idempotency_record TENANT_SCOPED owner=CMP-022
CREATE TABLE sf_credential.idempotency_record (
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
ALTER TABLE sf_credential.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_credential.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_credential.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_credential.idempotency_record OWNER TO sf_migrator;

-- Append-only provenance: artifacts, signing attempts and downstream outcomes are never changed.
CREATE FUNCTION sf_credential.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_credential, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'credential provenance is append-only' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_credential.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER credential_no_delete
  BEFORE DELETE ON sf_credential.credential
  FOR EACH ROW EXECUTE FUNCTION sf_credential.reject_mutation();
CREATE TRIGGER credential_artifact_immutable
  BEFORE UPDATE OR DELETE ON sf_credential.credential_artifact
  FOR EACH ROW EXECUTE FUNCTION sf_credential.reject_mutation();
CREATE TRIGGER signing_record_immutable
  BEFORE UPDATE OR DELETE ON sf_credential.signing_record
  FOR EACH ROW EXECUTE FUNCTION sf_credential.reject_mutation();
CREATE TRIGGER downstream_outcome_immutable
  BEFORE UPDATE OR DELETE ON sf_credential.downstream_outcome
  FOR EACH ROW EXECUTE FUNCTION sf_credential.reject_mutation();

-- Forward-only lifecycle. Provenance columns are immutable; only GENERATED -> SIGNED (with a
-- SIGNED attempt of this credential whose hash matches the SIGNED_ARTIFACT) and SIGNED -> ISSUED
-- are permitted. ISSUED is terminal. Invalid transitions raise 55000.
CREATE FUNCTION sf_credential.guard_credential_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_credential, pg_temp
AS $$
DECLARE
  attempt_result text;
  attempt_sha text;
  artifact_sha text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_status <> 'GENERATED' THEN
      RAISE EXCEPTION 'credential must be created GENERATED' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.credential_id, NEW.application_id, NEW.cell_id,
      NEW.tenant_service_binding_id, NEW.service_version_id, NEW.credential_template_id,
      NEW.credential_template_version, NEW.issuance_key, NEW.idempotency_key,
      NEW.approval_decision_ref, NEW.approval_decision_by_this_component, NEW.correlation_id,
      NEW.actor_type, NEW.created_by, NEW.generated_at, NEW.recorded_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.credential_id, OLD.application_id, OLD.cell_id,
      OLD.tenant_service_binding_id, OLD.service_version_id, OLD.credential_template_id,
      OLD.credential_template_version, OLD.issuance_key, OLD.idempotency_key,
      OLD.approval_decision_ref, OLD.approval_decision_by_this_component, OLD.correlation_id,
      OLD.actor_type, OLD.created_by, OLD.generated_at, OLD.recorded_at) THEN
    RAISE EXCEPTION 'credential provenance is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.lifecycle_status = 'GENERATED' AND NEW.lifecycle_status = 'SIGNED' THEN
    SELECT signing_result, signed_artifact_sha256 INTO attempt_result, attempt_sha
      FROM sf_credential.signing_record
     WHERE tenant_id = NEW.tenant_id AND signing_record_id = NEW.signing_record_id
       AND credential_id = NEW.credential_id;
    SELECT sha256 INTO artifact_sha
      FROM sf_credential.credential_artifact
     WHERE tenant_id = NEW.tenant_id AND credential_id = NEW.credential_id
       AND artifact_kind = 'SIGNED_ARTIFACT';
    IF attempt_result IS DISTINCT FROM 'SIGNED' OR artifact_sha IS NULL
       OR artifact_sha IS DISTINCT FROM attempt_sha THEN
      RAISE EXCEPTION 'credential cannot be SIGNED without a matching signed attempt and artifact'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.lifecycle_status = 'SIGNED' AND NEW.lifecycle_status = 'ISSUED'
     AND NEW.signing_record_id IS NOT DISTINCT FROM OLD.signing_record_id
     AND NEW.signed_at IS NOT DISTINCT FROM OLD.signed_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'credential lifecycle is forward-only (% -> %)', OLD.lifecycle_status, NEW.lifecycle_status
    USING ERRCODE = '55000';
END;
$$;
ALTER FUNCTION sf_credential.guard_credential_transition() OWNER TO sf_migrator;

CREATE TRIGGER credential_transition_guard
  BEFORE INSERT OR UPDATE ON sf_credential.credential
  FOR EACH ROW EXECUTE FUNCTION sf_credential.guard_credential_transition();

-- Artifacts and signing attempts are only accepted while the credential is GENERATED; downstream
-- outcomes only once it is ISSUED. Nothing can be attached that would rewrite an issued record.
CREATE FUNCTION sf_credential.guard_child_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_credential, pg_temp
AS $$
DECLARE
  current_status text;
  required_status text;
BEGIN
  required_status := CASE TG_TABLE_NAME WHEN 'downstream_outcome' THEN 'ISSUED' ELSE 'GENERATED' END;
  SELECT lifecycle_status INTO current_status
    FROM sf_credential.credential
   WHERE tenant_id = NEW.tenant_id AND credential_id = NEW.credential_id
   FOR UPDATE;
  IF current_status IS DISTINCT FROM required_status THEN
    RAISE EXCEPTION '% requires credential %', TG_TABLE_NAME, required_status USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_credential.guard_child_insert() OWNER TO sf_migrator;

CREATE TRIGGER credential_artifact_insert_guard
  BEFORE INSERT ON sf_credential.credential_artifact
  FOR EACH ROW EXECUTE FUNCTION sf_credential.guard_child_insert();
CREATE TRIGGER signing_record_insert_guard
  BEFORE INSERT ON sf_credential.signing_record
  FOR EACH ROW EXECUTE FUNCTION sf_credential.guard_child_insert();
CREATE TRIGGER downstream_outcome_insert_guard
  BEFORE INSERT ON sf_credential.downstream_outcome
  FOR EACH ROW EXECUTE FUNCTION sf_credential.guard_child_insert();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_credential FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_credential FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_credential FROM PUBLIC;

GRANT SELECT, INSERT ON sf_credential.credential TO sf_cmp022_rw;
GRANT UPDATE (lifecycle_status, signing_record_id, signed_at, issued_at)
  ON sf_credential.credential TO sf_cmp022_rw;
GRANT SELECT, INSERT ON sf_credential.credential_artifact TO sf_cmp022_rw;
GRANT SELECT, INSERT ON sf_credential.signing_record TO sf_cmp022_rw;
GRANT SELECT, INSERT ON sf_credential.downstream_outcome TO sf_cmp022_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_credential.idempotency_record TO sf_cmp022_rw;

GRANT EXECUTE ON FUNCTION sf_credential.reject_mutation() TO sf_cmp022_rw;
GRANT EXECUTE ON FUNCTION sf_credential.guard_credential_transition() TO sf_cmp022_rw;
GRANT EXECUTE ON FUNCTION sf_credential.guard_child_insert() TO sf_cmp022_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_credential FROM sf_cmp022_rw;
REVOKE ALL ON SCHEMA sf_credential FROM sf_app;
DROP SCHEMA IF EXISTS sf_credential CASCADE;
-- Role sf_cmp022_rw retained (may be referenced by runtime logins); never DROP ROLE here.
