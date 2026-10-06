-- CMP-027 Grievance & Feedback (SF-M05-007). ADR-0006 Option A: sf_cmp027_rw NOLOGIN
-- holds DML; FORCE RLS; PUBLIC revoked; runtime is not table owner (sf_migrator).
-- Generic metadata-driven grievance/feedback. No named-service branching. Assignment is
-- role + organisation/office + jurisdiction + service scope (Constitution #19). Opaque
-- service_id / application_id linkage only; no cross-component SQL. AI assist is advisory.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp027_rw') THEN
    CREATE ROLE sf_cmp027_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp027_rw IS
  'ADR-0006: CMP-027 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_grievance AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_grievance IS
  'isolation_class=TENANT_SCOPED; owner=CMP-027; grievance/feedback records, routing, responses';

REVOKE ALL ON SCHEMA sf_grievance FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_grievance TO sf_cmp027_rw;
GRANT USAGE ON SCHEMA sf_grievance TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_grievance REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_grievance REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_grievance REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_grievance.grievance TENANT_SCOPED owner=CMP-027
CREATE TABLE sf_grievance.grievance (
  grievance_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  kind text NOT NULL CHECK (kind IN ('GRIEVANCE', 'FEEDBACK')),
  status text NOT NULL CHECK (status IN (
    'FILED', 'CATEGORISED', 'ROUTED', 'OPEN', 'PENDING_RESPONSE', 'RESOLVED', 'CLOSED', 'WITHDRAWN'
  )),
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 1),
  reference_code text NOT NULL CHECK (reference_code ~ '^GF-[A-Z0-9-]{8,32}$'),
  category_code text CHECK (category_code IS NULL OR category_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  filer_id uuid NOT NULL,
  organisation_id uuid,
  jurisdiction_id uuid,
  office_id uuid,
  service_id uuid,
  application_id uuid,
  workflow_version_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_correlation_id uuid NOT NULL,
  UNIQUE (tenant_id, grievance_id),
  UNIQUE (tenant_id, reference_code),
  CHECK (status IN ('FILED', 'WITHDRAWN') OR category_code IS NOT NULL)
);
CREATE INDEX grievance_status_idx ON sf_grievance.grievance (tenant_id, status, updated_at DESC);
CREATE INDEX grievance_filer_idx ON sf_grievance.grievance (tenant_id, filer_id, created_at DESC);
ALTER TABLE sf_grievance.grievance ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_grievance.grievance FORCE ROW LEVEL SECURITY;
CREATE POLICY grievance_tenant ON sf_grievance.grievance TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_grievance.grievance OWNER TO sf_migrator;

-- sf:isolation sf_grievance.grievance_transition TENANT_SCOPED owner=CMP-027
CREATE TABLE sf_grievance.grievance_transition (
  transition_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  grievance_id uuid NOT NULL,
  command text NOT NULL CHECK (command ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  from_status text,
  to_status text NOT NULL,
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 1),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  authz_decision_id uuid NOT NULL,
  authz_policy_revision text NOT NULL CHECK (char_length(authz_policy_revision) BETWEEN 1 AND 128),
  correlation_id uuid NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  actor_id uuid NOT NULL,
  reason_code text CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  policy_ref text CHECK (policy_ref IS NULL OR char_length(policy_ref) BETWEEN 1 AND 200),
  occurred_at timestamptz NOT NULL,
  UNIQUE (tenant_id, grievance_id, aggregate_version),
  FOREIGN KEY (tenant_id, grievance_id)
    REFERENCES sf_grievance.grievance (tenant_id, grievance_id)
);
ALTER TABLE sf_grievance.grievance_transition ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_grievance.grievance_transition FORCE ROW LEVEL SECURITY;
CREATE POLICY grievance_transition_tenant ON sf_grievance.grievance_transition TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_grievance.grievance_transition OWNER TO sf_migrator;

-- sf:isolation sf_grievance.grievance_response TENANT_SCOPED owner=CMP-027
CREATE TABLE sf_grievance.grievance_response (
  response_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  grievance_id uuid NOT NULL,
  author_actor_type text NOT NULL CHECK (author_actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  author_id uuid NOT NULL,
  body_ref text NOT NULL CHECK (char_length(body_ref) BETWEEN 8 AND 200),
  created_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  UNIQUE (tenant_id, response_id),
  FOREIGN KEY (tenant_id, grievance_id)
    REFERENCES sf_grievance.grievance (tenant_id, grievance_id)
);
ALTER TABLE sf_grievance.grievance_response ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_grievance.grievance_response FORCE ROW LEVEL SECURITY;
CREATE POLICY grievance_response_tenant ON sf_grievance.grievance_response TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_grievance.grievance_response OWNER TO sf_migrator;

-- sf:isolation sf_grievance.assignment_request TENANT_SCOPED owner=CMP-027
CREATE TABLE sf_grievance.assignment_request (
  request_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  grievance_id uuid NOT NULL,
  role_code text NOT NULL CHECK (role_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  organisation_id uuid NOT NULL,
  office_id uuid,
  jurisdiction_id uuid NOT NULL,
  service_scope_id uuid,
  status text NOT NULL CHECK (status IN ('REQUESTED')),
  created_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  UNIQUE (tenant_id, request_id),
  UNIQUE (tenant_id, grievance_id),
  FOREIGN KEY (tenant_id, grievance_id)
    REFERENCES sf_grievance.grievance (tenant_id, grievance_id)
);
ALTER TABLE sf_grievance.assignment_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_grievance.assignment_request FORCE ROW LEVEL SECURITY;
CREATE POLICY assignment_request_tenant ON sf_grievance.assignment_request TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_grievance.assignment_request OWNER TO sf_migrator;

-- sf:isolation sf_grievance.ai_assist_record TENANT_SCOPED owner=CMP-027
CREATE TABLE sf_grievance.ai_assist_record (
  assist_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  grievance_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'CLASSIFY', 'SUMMARIZE', 'SUGGEST_ROUTING', 'DRAFT_RESPONSE', 'DETECT_DUPLICATE'
  )),
  suggestion_code text CHECK (suggestion_code IS NULL OR suggestion_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  duplicate_of_id uuid,
  created_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  UNIQUE (tenant_id, assist_id),
  FOREIGN KEY (tenant_id, grievance_id)
    REFERENCES sf_grievance.grievance (tenant_id, grievance_id)
);
ALTER TABLE sf_grievance.ai_assist_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_grievance.ai_assist_record FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_assist_record_tenant ON sf_grievance.ai_assist_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_grievance.ai_assist_record OWNER TO sf_migrator;

-- sf:isolation sf_grievance.idempotency_record TENANT_SCOPED owner=CMP-027
CREATE TABLE sf_grievance.idempotency_record (
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
ALTER TABLE sf_grievance.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_grievance.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_tenant ON sf_grievance.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_grievance.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_grievance.enforce_grievance() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  legal constant text[] := ARRAY[
    'FILED>CATEGORISED', 'FILED>WITHDRAWN',
    'CATEGORISED>ROUTED', 'CATEGORISED>WITHDRAWN',
    'ROUTED>OPEN', 'ROUTED>WITHDRAWN',
    'OPEN>PENDING_RESPONSE', 'OPEN>RESOLVED', 'OPEN>WITHDRAWN',
    'PENDING_RESPONSE>OPEN', 'PENDING_RESPONSE>RESOLVED', 'PENDING_RESPONSE>WITHDRAWN',
    'RESOLVED>CLOSED'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'grievance rows are never deleted'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'FILED' OR NEW.aggregate_version <> 1 THEN
      RAISE EXCEPTION 'a grievance is created only as FILED at aggregate_version 1'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.grievance_id, NEW.tenant_id, NEW.cell_id, NEW.kind, NEW.filer_id, NEW.created_by,
      NEW.created_at, NEW.reference_code, NEW.service_id, NEW.application_id)
     IS DISTINCT FROM
     (OLD.grievance_id, OLD.tenant_id, OLD.cell_id, OLD.kind, OLD.filer_id, OLD.created_by,
      OLD.created_at, OLD.reference_code, OLD.service_id, OLD.application_id) THEN
    RAISE EXCEPTION 'grievance identity columns are immutable'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  IF NEW.aggregate_version <> OLD.aggregate_version + 1 THEN
    RAISE EXCEPTION 'aggregate_version must advance by exactly one'
      USING ERRCODE = 'P0001', HINT = 'SF_STALE_VERSION';
  END IF;
  IF NOT ((OLD.status || '>' || NEW.status) = ANY (legal)) THEN
    RAISE EXCEPTION 'illegal grievance transition'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_grievance.enforce_grievance() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_grievance.enforce_grievance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_grievance.enforce_grievance() TO sf_cmp027_rw;

CREATE TRIGGER grievance_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_grievance.grievance
  FOR EACH ROW
  EXECUTE FUNCTION sf_grievance.enforce_grievance();

CREATE FUNCTION sf_grievance.prevent_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'append-only grievance child rows'
    USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
END
$$;
ALTER FUNCTION sf_grievance.prevent_mutation() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_grievance.prevent_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_grievance.prevent_mutation() TO sf_cmp027_rw;

CREATE TRIGGER grievance_transition_immutable
  BEFORE UPDATE OR DELETE ON sf_grievance.grievance_transition
  FOR EACH ROW
  EXECUTE FUNCTION sf_grievance.prevent_mutation();

CREATE TRIGGER grievance_response_immutable
  BEFORE UPDATE OR DELETE ON sf_grievance.grievance_response
  FOR EACH ROW
  EXECUTE FUNCTION sf_grievance.prevent_mutation();

CREATE TRIGGER assignment_request_immutable
  BEFORE UPDATE OR DELETE ON sf_grievance.assignment_request
  FOR EACH ROW
  EXECUTE FUNCTION sf_grievance.prevent_mutation();

CREATE TRIGGER ai_assist_record_immutable
  BEFORE UPDATE OR DELETE ON sf_grievance.ai_assist_record
  FOR EACH ROW
  EXECUTE FUNCTION sf_grievance.prevent_mutation();

GRANT SELECT, INSERT ON sf_grievance.grievance TO sf_cmp027_rw;
GRANT UPDATE (
  status, aggregate_version, category_code, organisation_id, jurisdiction_id, office_id,
  workflow_version_id, updated_at, last_correlation_id
) ON sf_grievance.grievance TO sf_cmp027_rw;
GRANT SELECT, INSERT ON sf_grievance.grievance_transition TO sf_cmp027_rw;
GRANT SELECT, INSERT ON sf_grievance.grievance_response TO sf_cmp027_rw;
GRANT SELECT, INSERT ON sf_grievance.assignment_request TO sf_cmp027_rw;
GRANT SELECT, INSERT ON sf_grievance.ai_assist_record TO sf_cmp027_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (
  status, response_ref, response_status, response_body
) ON sf_grievance.idempotency_record TO sf_cmp027_rw;

REVOKE ALL ON sf_grievance.grievance FROM PUBLIC;
REVOKE ALL ON sf_grievance.grievance_transition FROM PUBLIC;
REVOKE ALL ON sf_grievance.grievance_response FROM PUBLIC;
REVOKE ALL ON sf_grievance.assignment_request FROM PUBLIC;
REVOKE ALL ON sf_grievance.ai_assist_record FROM PUBLIC;
REVOKE ALL ON sf_grievance.idempotency_record FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS ai_assist_record_immutable ON sf_grievance.ai_assist_record;
DROP TRIGGER IF EXISTS assignment_request_immutable ON sf_grievance.assignment_request;
DROP TRIGGER IF EXISTS grievance_response_immutable ON sf_grievance.grievance_response;
DROP TRIGGER IF EXISTS grievance_transition_immutable ON sf_grievance.grievance_transition;
DROP TRIGGER IF EXISTS grievance_guard ON sf_grievance.grievance;
DROP FUNCTION IF EXISTS sf_grievance.prevent_mutation();
DROP FUNCTION IF EXISTS sf_grievance.enforce_grievance();
DROP TABLE IF EXISTS sf_grievance.idempotency_record;
DROP TABLE IF EXISTS sf_grievance.ai_assist_record;
DROP TABLE IF EXISTS sf_grievance.assignment_request;
DROP TABLE IF EXISTS sf_grievance.grievance_response;
DROP TABLE IF EXISTS sf_grievance.grievance_transition;
DROP TABLE IF EXISTS sf_grievance.grievance;
DROP SCHEMA IF EXISTS sf_grievance;
-- Role sf_cmp027_rw retained (may be referenced by runtime logins); never DROP ROLE here.
