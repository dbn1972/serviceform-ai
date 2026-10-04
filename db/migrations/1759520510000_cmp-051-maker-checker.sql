-- CMP-051 Maker-Checker / Publishing Service (SF-M03-004). ADR-0006 Option A: sf_cmp051_rw NOLOGIN
-- holds DML; FORCE RLS; PUBLIC revoked; runtime is not table owner (sf_migrator).
-- Checker approval required before publication. CMP-043 AI review is advisory and must not block.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp051_rw') THEN
    CREATE ROLE sf_cmp051_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp051_rw IS
  'ADR-0006: CMP-051 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_maker_checker AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_maker_checker IS
  'isolation_class=mixed; owner=CMP-051; publication review requests';

REVOKE ALL ON SCHEMA sf_maker_checker FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_maker_checker TO sf_cmp051_rw;
GRANT USAGE ON SCHEMA sf_maker_checker TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_maker_checker REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_maker_checker REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_maker_checker REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_maker_checker.publication_request TENANT_SCOPED owner=CMP-051
CREATE TABLE sf_maker_checker.publication_request (
  request_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  subject_type text NOT NULL CHECK (subject_type IN ('TENANT_SERVICE_BINDING')),
  subject_id uuid NOT NULL,
  proposed_hash text NOT NULL CHECK (proposed_hash ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
  maker_principal_id uuid NOT NULL,
  checker_principal_id uuid,
  submit_reason text CHECK (submit_reason IS NULL OR char_length(submit_reason) BETWEEN 1 AND 1000),
  decision_reason text CHECK (decision_reason IS NULL OR char_length(decision_reason) BETWEEN 1 AND 1000),
  ai_advisory jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(ai_advisory::text) <= 8192),
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  decided_at timestamptz,
  UNIQUE (tenant_id, request_id),
  CHECK (checker_principal_id IS NULL OR checker_principal_id <> maker_principal_id),
  CHECK (status <> 'SUBMITTED' OR submitted_at IS NOT NULL),
  CHECK (status NOT IN ('APPROVED', 'REJECTED') OR (decided_at IS NOT NULL AND checker_principal_id IS NOT NULL))
);
CREATE INDEX publication_request_subject_idx
  ON sf_maker_checker.publication_request (tenant_id, subject_type, subject_id, status);
ALTER TABLE sf_maker_checker.publication_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_maker_checker.publication_request FORCE ROW LEVEL SECURITY;
CREATE POLICY publication_request_tenant ON sf_maker_checker.publication_request TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_maker_checker.publication_request OWNER TO sf_migrator;

CREATE FUNCTION sf_maker_checker.enforce_review_transition() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('APPROVED', 'REJECTED') THEN
      RAISE EXCEPTION 'publication decision is immutable'
        USING ERRCODE = 'P0001', HINT = 'SF_PUBLISHED_IMMUTABLE';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'publication decision is immutable'
      USING ERRCODE = 'P0001', HINT = 'SF_PUBLISHED_IMMUTABLE';
  END IF;
  IF NEW.status IN ('APPROVED', 'REJECTED') THEN
    IF OLD.status <> 'SUBMITTED' THEN
      RAISE EXCEPTION 'checker decision requires submitted request'
        USING ERRCODE = 'P0001', HINT = 'SF_CHECKER_REQUIRED';
    END IF;
    IF NEW.checker_principal_id IS NULL OR NEW.checker_principal_id = OLD.maker_principal_id THEN
      RAISE EXCEPTION 'maker cannot approve or reject own request'
        USING ERRCODE = 'P0001', HINT = 'SF_MAKER_CHECKER';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_maker_checker.enforce_review_transition() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_maker_checker.enforce_review_transition() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_maker_checker.enforce_review_transition() TO sf_app, sf_cmp051_rw;

CREATE TRIGGER publication_request_review_transition
  BEFORE UPDATE OR DELETE ON sf_maker_checker.publication_request
  FOR EACH ROW
  EXECUTE FUNCTION sf_maker_checker.enforce_review_transition();

-- sf:isolation sf_maker_checker.idempotency_record TENANT_SCOPED owner=CMP-051
CREATE TABLE sf_maker_checker.idempotency_record (
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
ALTER TABLE sf_maker_checker.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_maker_checker.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_tenant ON sf_maker_checker.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_maker_checker.idempotency_record OWNER TO sf_migrator;

GRANT SELECT, INSERT, UPDATE (
  status, checker_principal_id, submit_reason, decision_reason, ai_advisory,
  aggregate_version, submitted_at, decided_at
) ON sf_maker_checker.publication_request TO sf_cmp051_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (
  status, response_ref, response_status, response_body
) ON sf_maker_checker.idempotency_record TO sf_cmp051_rw;

REVOKE ALL ON sf_maker_checker.publication_request FROM PUBLIC;
REVOKE ALL ON sf_maker_checker.idempotency_record FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS publication_request_review_transition ON sf_maker_checker.publication_request;
DROP FUNCTION IF EXISTS sf_maker_checker.enforce_review_transition();
DROP TABLE IF EXISTS sf_maker_checker.idempotency_record;
DROP TABLE IF EXISTS sf_maker_checker.publication_request;
DROP SCHEMA IF EXISTS sf_maker_checker;
-- Role sf_cmp051_rw retained (may be referenced by runtime logins); never DROP ROLE here.
