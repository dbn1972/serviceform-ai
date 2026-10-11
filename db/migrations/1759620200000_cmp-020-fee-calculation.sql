-- CMP-020 Fee & Calculation (SF-M06-001). ADR-0006 Option A: sf_cmp020_rw NOLOGIN holds DML;
-- FORCE RLS; PUBLIC revoked; runtime is not the table owner (sf_migrator).
-- CMP-020 owns issued fee quotes and their line items only. It stores no fee schedule, rate table
-- or waiver rule: amounts are copied from the pinned published fee-policy version (metadata) and
-- the pinned CMP-008 rule evaluation at quote time. Quotes are immutable once issued
-- (SF-CON-FEE-QUOTE). This migration grants no privilege on peer component schemas.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp020_rw') THEN
    CREATE ROLE sf_cmp020_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp020_rw IS
  'ADR-0006: CMP-020 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_fee AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_fee IS
  'isolation_class=TENANT_SCOPED; owner=CMP-020; immutable fee quotes and quote lines';

REVOKE ALL ON SCHEMA sf_fee FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_fee TO sf_cmp020_rw;
GRANT USAGE ON SCHEMA sf_fee TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_fee REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_fee REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_fee REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_fee.fee_quote TENANT_SCOPED owner=CMP-020
CREATE TABLE sf_fee.fee_quote (
  tenant_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  application_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  tenant_service_binding_id uuid NOT NULL,
  fee_policy_version_id uuid NOT NULL,
  fee_policy_content_hash text NOT NULL CHECK (fee_policy_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  rule_version_id uuid NOT NULL,
  rule_content_hash text CHECK (rule_content_hash IS NULL OR rule_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  rule_evaluation_id uuid,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  total_amount_minor bigint NOT NULL CHECK (total_amount_minor BETWEEN 0 AND 9007199254740991),
  amount_source text NOT NULL CHECK (amount_source IN ('RULES_ENGINE', 'FEE_POLICY_METADATA')),
  client_authoritative_amount boolean NOT NULL DEFAULT false CHECK (client_authoritative_amount = false),
  waiver_policy_ref text CHECK (waiver_policy_ref IS NULL OR char_length(waiver_policy_ref) BETWEEN 1 AND 128),
  facts_hash text NOT NULL CHECK (facts_hash ~ '^sha256:[0-9a-f]{64}$'),
  calculation_hash text NOT NULL CHECK (calculation_hash ~ '^sha256:[0-9a-f]{64}$'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  correlation_id uuid NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  issued_by uuid NOT NULL,
  issued_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, quote_id),
  UNIQUE (tenant_id, application_id, calculation_hash),
  CHECK ((amount_source = 'RULES_ENGINE') = (rule_content_hash IS NOT NULL AND rule_evaluation_id IS NOT NULL))
);
CREATE INDEX fee_quote_application_idx ON sf_fee.fee_quote (tenant_id, application_id, issued_at);
ALTER TABLE sf_fee.fee_quote ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_fee.fee_quote FORCE ROW LEVEL SECURITY;
CREATE POLICY fee_quote_isolation ON sf_fee.fee_quote TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_fee.fee_quote OWNER TO sf_migrator;

-- sf:isolation sf_fee.fee_quote_line TENANT_SCOPED owner=CMP-020
CREATE TABLE sf_fee.fee_quote_line (
  tenant_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  line_seq smallint NOT NULL CHECK (line_seq BETWEEN 1 AND 64),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_.-]{1,64}$'),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 0 AND 9007199254740991),
  calculation_basis text NOT NULL CHECK (calculation_basis IN ('FEE_POLICY_LINE', 'RULES_ENGINE_LINE')),
  description_code text CHECK (description_code IS NULL OR char_length(description_code) BETWEEN 1 AND 64),
  rule_output_key text CHECK (rule_output_key IS NULL OR rule_output_key ~ '^[A-Za-z][A-Za-z0-9_.]{0,63}$'),
  PRIMARY KEY (tenant_id, quote_id, line_seq),
  UNIQUE (tenant_id, quote_id, code),
  CHECK ((calculation_basis = 'RULES_ENGINE_LINE') = (rule_output_key IS NOT NULL)),
  FOREIGN KEY (tenant_id, quote_id) REFERENCES sf_fee.fee_quote (tenant_id, quote_id)
);
ALTER TABLE sf_fee.fee_quote_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_fee.fee_quote_line FORCE ROW LEVEL SECURITY;
CREATE POLICY fee_quote_line_isolation ON sf_fee.fee_quote_line TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_fee.fee_quote_line OWNER TO sf_migrator;

-- sf:isolation sf_fee.idempotency_record TENANT_SCOPED owner=CMP-020
CREATE TABLE sf_fee.idempotency_record (
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
ALTER TABLE sf_fee.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_fee.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_fee.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_fee.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_fee.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_fee, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'issued fee quotes are immutable' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_fee.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER fee_quote_immutable
  BEFORE UPDATE OR DELETE ON sf_fee.fee_quote
  FOR EACH ROW EXECUTE FUNCTION sf_fee.reject_mutation();

CREATE TRIGGER fee_quote_line_immutable
  BEFORE UPDATE OR DELETE ON sf_fee.fee_quote_line
  FOR EACH ROW EXECUTE FUNCTION sf_fee.reject_mutation();

-- Commit-time integrity: a quote has at least one line, its total is the exact integer sum of its
-- lines, and RULES_ENGINE is declared exactly when a line came from the rules engine.
CREATE FUNCTION sf_fee.assert_quote_consistent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_fee, pg_temp
AS $$
DECLARE
  line_count integer;
  line_sum numeric;
  rules_lines integer;
BEGIN
  SELECT count(*), coalesce(sum(amount_minor), 0),
         count(*) FILTER (WHERE calculation_basis = 'RULES_ENGINE_LINE')
    INTO line_count, line_sum, rules_lines
    FROM sf_fee.fee_quote_line
   WHERE tenant_id = NEW.tenant_id AND quote_id = NEW.quote_id;
  IF line_count < 1 THEN
    RAISE EXCEPTION 'fee quote % has no lines', NEW.quote_id USING ERRCODE = '23514';
  END IF;
  IF line_sum <> NEW.total_amount_minor THEN
    RAISE EXCEPTION 'fee quote % total does not equal sum of lines', NEW.quote_id USING ERRCODE = '23514';
  END IF;
  IF (rules_lines > 0) <> (NEW.amount_source = 'RULES_ENGINE') THEN
    RAISE EXCEPTION 'fee quote % amount_source inconsistent with lines', NEW.quote_id USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
ALTER FUNCTION sf_fee.assert_quote_consistent() OWNER TO sf_migrator;

CREATE CONSTRAINT TRIGGER fee_quote_consistent
  AFTER INSERT ON sf_fee.fee_quote
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sf_fee.assert_quote_consistent();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_fee FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_fee FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_fee FROM PUBLIC;

GRANT SELECT, INSERT ON sf_fee.fee_quote TO sf_cmp020_rw;
GRANT SELECT, INSERT ON sf_fee.fee_quote_line TO sf_cmp020_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_fee.idempotency_record TO sf_cmp020_rw;

GRANT EXECUTE ON FUNCTION sf_fee.reject_mutation() TO sf_cmp020_rw;
GRANT EXECUTE ON FUNCTION sf_fee.assert_quote_consistent() TO sf_cmp020_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_fee FROM sf_cmp020_rw;
REVOKE ALL ON SCHEMA sf_fee FROM sf_app;
DROP SCHEMA IF EXISTS sf_fee CASCADE;
-- Role sf_cmp020_rw retained (may be referenced by runtime logins); never DROP ROLE here.
