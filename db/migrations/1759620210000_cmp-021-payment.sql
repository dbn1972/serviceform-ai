-- CMP-021 Payment Service (SF-M06-004). ADR-0006 Option A: sf_cmp021_rw NOLOGIN holds DML;
-- FORCE RLS; PUBLIC revoked; runtime is not the table owner (sf_migrator).
-- CMP-021 owns payment intents, payment callbacks, exactly-once effect records and idempotency
-- records only. Amounts are locked from the fee quote (SF-CON-FEE-QUOTE). Client-supplied amounts
-- are forbidden. PSP secrets are never stored here: connector_binding_id is a foreign reference to
-- CMP-037. Network calls (gateway, workflow) happen outside any database transaction.
-- This migration grants no privilege on peer component schemas.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp021_rw') THEN
    CREATE ROLE sf_cmp021_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp021_rw IS
  'ADR-0006: CMP-021 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_payment AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_payment IS
  'isolation_class=TENANT_SCOPED; owner=CMP-021; payment intents, callbacks and exactly-once records';

REVOKE ALL ON SCHEMA sf_payment FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_payment TO sf_cmp021_rw;
GRANT USAGE ON SCHEMA sf_payment TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_payment REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_payment REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_payment REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_payment.payment_intent TENANT_SCOPED owner=CMP-021
CREATE TABLE sf_payment.payment_intent (
  tenant_id uuid NOT NULL,
  payment_intent_id uuid NOT NULL,
  fee_quote_id uuid NOT NULL,
  application_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 0 AND 9007199254740991),
  amount_locked_from_fee_quote boolean NOT NULL DEFAULT true CHECK (amount_locked_from_fee_quote = true),
  client_supplied_amount_forbidden boolean NOT NULL DEFAULT true CHECK (client_supplied_amount_forbidden = true),
  status text NOT NULL CHECK (status IN ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED')),
  connector_binding_id uuid NOT NULL,
  connector_mode text NOT NULL CHECK (connector_mode IN ('REAL', 'SANDBOX', 'SIMULATED')),
  simulation_marker jsonb,
  psp_session_ref text CHECK (psp_session_ref IS NULL OR char_length(psp_session_ref) BETWEEN 1 AND 256),
  psp_redirect_url text CHECK (psp_redirect_url IS NULL OR char_length(psp_redirect_url) BETWEEN 1 AND 2048),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  correlation_id uuid NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, payment_intent_id),
  CONSTRAINT simulation_marker_required_when_simulated CHECK (
    connector_mode <> 'SIMULATED' OR simulation_marker IS NOT NULL
  )
);
CREATE INDEX payment_intent_fee_quote_idx ON sf_payment.payment_intent (tenant_id, fee_quote_id);
CREATE INDEX payment_intent_application_idx ON sf_payment.payment_intent (tenant_id, application_id, created_at);
ALTER TABLE sf_payment.payment_intent ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_payment.payment_intent FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_intent_isolation ON sf_payment.payment_intent TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_payment.payment_intent OWNER TO sf_migrator;

-- sf:isolation sf_payment.payment_callback TENANT_SCOPED owner=CMP-021
CREATE TABLE sf_payment.payment_callback (
  tenant_id uuid NOT NULL,
  callback_id uuid NOT NULL,
  payment_intent_id uuid NOT NULL,
  application_id uuid NOT NULL,
  exactly_once_key text NOT NULL CHECK (exactly_once_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  verification_result text NOT NULL CHECK (verification_result IN ('VERIFIED', 'REJECTED')),
  signature_verified boolean NOT NULL,
  financial_effect_applied boolean NOT NULL,
  duplicate_financial_effect_forbidden boolean NOT NULL DEFAULT true CHECK (duplicate_financial_effect_forbidden = true),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  correlation_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, callback_id),
  FOREIGN KEY (tenant_id, payment_intent_id) REFERENCES sf_payment.payment_intent (tenant_id, payment_intent_id),
  CHECK (
    verification_result <> 'VERIFIED' OR financial_effect_applied = false OR signature_verified = true
  ),
  CHECK (
    verification_result <> 'REJECTED' OR financial_effect_applied = false
  )
);
CREATE INDEX payment_callback_intent_idx ON sf_payment.payment_callback (tenant_id, payment_intent_id);
ALTER TABLE sf_payment.payment_callback ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_payment.payment_callback FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_callback_isolation ON sf_payment.payment_callback TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_payment.payment_callback OWNER TO sf_migrator;

-- sf:isolation sf_payment.exactly_once_effect TENANT_SCOPED owner=CMP-021
CREATE TABLE sf_payment.exactly_once_effect (
  tenant_id uuid NOT NULL,
  exactly_once_key text NOT NULL CHECK (exactly_once_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  callback_id uuid NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, exactly_once_key)
);
ALTER TABLE sf_payment.exactly_once_effect ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_payment.exactly_once_effect FORCE ROW LEVEL SECURITY;
CREATE POLICY exactly_once_effect_isolation ON sf_payment.exactly_once_effect TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_payment.exactly_once_effect OWNER TO sf_migrator;

-- sf:isolation sf_payment.idempotency_record TENANT_SCOPED owner=CMP-021
CREATE TABLE sf_payment.idempotency_record (
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
ALTER TABLE sf_payment.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_payment.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_payment.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_payment.idempotency_record OWNER TO sf_migrator;

REVOKE ALL ON ALL TABLES IN SCHEMA sf_payment FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_payment FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_payment FROM PUBLIC;

GRANT SELECT, INSERT ON sf_payment.payment_intent TO sf_cmp021_rw;
GRANT SELECT, INSERT, UPDATE (status) ON sf_payment.payment_intent TO sf_cmp021_rw;
GRANT SELECT, INSERT ON sf_payment.payment_callback TO sf_cmp021_rw;
GRANT SELECT, INSERT ON sf_payment.exactly_once_effect TO sf_cmp021_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_payment.idempotency_record TO sf_cmp021_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_payment FROM sf_cmp021_rw;
REVOKE ALL ON SCHEMA sf_payment FROM sf_app;
DROP SCHEMA IF EXISTS sf_payment CASCADE;
-- Role sf_cmp021_rw retained; never DROP ROLE here.
