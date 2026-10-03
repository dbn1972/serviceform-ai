-- CMP-037 Integration Hub schema, ADR-0006 privilege role, and domain tables.
-- Schema name per PLAN-REVIEW X-2. Privilege role sf_cmp037_rw per ADR-0006 Option A.

-- Up Migration

CREATE SCHEMA IF NOT EXISTS sf_integration_hub;
COMMENT ON SCHEMA sf_integration_hub IS
  'isolation_class=mixed; owner=CMP-037; connector registry, bindings and invocation lifecycle';

-- Shared Wave 1 schema/table owner. Create once idempotently; other CMP migrations
-- use the same guarded DO block. Never DROP this role on down.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_migrator') THEN
    CREATE ROLE sf_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- CMP-037 DML privilege role (ADR-0006 Option A). Role creation is guarded via pg_roles.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp037_rw') THEN
    CREATE ROLE sf_cmp037_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
COMMENT ON ROLE sf_cmp037_rw IS
  'ADR-0006: CMP-037 DML privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

REVOKE ALL ON SCHEMA sf_integration_hub FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA sf_integration_hub REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA sf_integration_hub REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA sf_integration_hub REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_integration_hub TO sf_cmp037_rw;
GRANT USAGE ON SCHEMA sf_integration_hub TO sf_app;

-- sf:isolation sf_integration_hub.connector_definition GLOBAL owner=CMP-037
CREATE TABLE sf_integration_hub.connector_definition (
  connector_definition_id uuid PRIMARY KEY,
  connector_type text NOT NULL CHECK (connector_type IN (
    'PAYMENT', 'OTP', 'SMS', 'EMAIL', 'DIGILOCKER', 'ESIGN', 'DEPARTMENT_API'
  )),
  adapter_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  supported_modes text[] NOT NULL CHECK (
    supported_modes <@ ARRAY['REAL', 'SANDBOX', 'SIMULATED']::text[]
    AND cardinality(supported_modes) >= 1
  ),
  retry_policy jsonb,
  timeout_ms integer NOT NULL CHECK (timeout_ms > 0 AND timeout_ms <= 120000),
  webhook_signature_scheme text,
  egress_allowlist text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- sf:isolation sf_integration_hub.connector_binding TENANT_SCOPED owner=CMP-037
CREATE TABLE sf_integration_hub.connector_binding (
  connector_binding_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  service_id uuid,
  connector_definition_id uuid NOT NULL REFERENCES sf_integration_hub.connector_definition (connector_definition_id),
  connector_type text NOT NULL CHECK (connector_type IN (
    'PAYMENT', 'OTP', 'SMS', 'EMAIL', 'DIGILOCKER', 'ESIGN', 'DEPARTMENT_API'
  )),
  mode text NOT NULL CHECK (mode IN ('REAL', 'SANDBOX', 'SIMULATED')),
  environment text NOT NULL CHECK (environment IN (
    'LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE', 'UAT', 'PREPROD', 'PRODUCTION'
  )),
  critical boolean NOT NULL,
  secret_ref text CHECK (
    secret_ref IS NULL OR secret_ref ~ '^(aws-sm|aws-ssm|vault)://[A-Za-z0-9/_.+=@-]+$'
  ),
  simulator_version text CHECK (simulator_version IS NULL OR char_length(simulator_version) BETWEEN 1 AND 40),
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (environment <> 'PRODUCTION' OR mode = 'REAL'),
  CHECK (environment NOT IN ('LOCAL', 'CI') OR mode = 'SIMULATED'),
  CHECK (
    mode <> 'SIMULATED'
    OR (
      simulator_version IS NOT NULL
      AND environment IN ('LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE')
    )
  ),
  CHECK (mode NOT IN ('REAL', 'SANDBOX') OR secret_ref IS NOT NULL),
  CHECK (
    environment <> 'PRODUCTION'
    OR mode <> 'REAL'
    OR secret_ref IS NULL
    OR secret_ref NOT LIKE 'vault://sim/%'
  )
);
CREATE UNIQUE INDEX connector_binding_tenant_id_idx
  ON sf_integration_hub.connector_binding (tenant_id, connector_binding_id);
CREATE UNIQUE INDEX connector_binding_enabled_uniq
  ON sf_integration_hub.connector_binding (
    tenant_id,
    COALESCE(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
    connector_type,
    environment
  )
  WHERE enabled;
ALTER TABLE sf_integration_hub.connector_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_integration_hub.connector_binding FORCE ROW LEVEL SECURITY;
CREATE POLICY connector_binding_tenant ON sf_integration_hub.connector_binding TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());

-- sf:isolation sf_integration_hub.connector_transaction TENANT_SCOPED owner=CMP-037
CREATE TABLE sf_integration_hub.connector_transaction (
  connector_transaction_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  connector_binding_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('INVOKE', 'WEBHOOK')),
  operation text NOT NULL,
  idempotency_key text,
  request_fingerprint text NOT NULL,
  provider_reference text,
  status text NOT NULL CHECK (status IN (
    'PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CIRCUIT_OPEN'
  )),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  response_ref text,
  mode text NOT NULL CHECK (mode IN ('REAL', 'SANDBOX', 'SIMULATED')),
  environment text NOT NULL,
  simulation jsonb,
  correlation_id uuid NOT NULL,
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (tenant_id, connector_binding_id)
    REFERENCES sf_integration_hub.connector_binding (tenant_id, connector_binding_id),
  CHECK (mode <> 'SIMULATED' OR simulation IS NOT NULL)
);
CREATE UNIQUE INDEX connector_transaction_idempotency_uniq
  ON sf_integration_hub.connector_transaction (
    tenant_id, connector_binding_id, direction, idempotency_key
  )
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX connector_transaction_webhook_ref_uniq
  ON sf_integration_hub.connector_transaction (
    tenant_id, connector_binding_id, provider_reference
  )
  WHERE direction = 'WEBHOOK' AND provider_reference IS NOT NULL;
ALTER TABLE sf_integration_hub.connector_transaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_integration_hub.connector_transaction FORCE ROW LEVEL SECURITY;
CREATE POLICY connector_transaction_tenant ON sf_integration_hub.connector_transaction TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());

-- sf:isolation sf_integration_hub.connector_binding_index PLATFORM_OPERATIONAL owner=CMP-037
CREATE TABLE sf_integration_hub.connector_binding_index (
  binding_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  environment text NOT NULL,
  mode text NOT NULL,
  critical boolean NOT NULL,
  enabled boolean NOT NULL,
  connector_type text NOT NULL,
  secret_ref text,
  simulator_version text,
  service_id uuid,
  FOREIGN KEY (tenant_id, binding_id)
    REFERENCES sf_integration_hub.connector_binding (tenant_id, connector_binding_id)
);
ALTER TABLE sf_integration_hub.connector_binding_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_integration_hub.connector_binding_index FORCE ROW LEVEL SECURITY;
CREATE POLICY connector_binding_index_select ON sf_integration_hub.connector_binding_index
  FOR SELECT TO sf_app USING (true);
CREATE POLICY connector_binding_index_insert ON sf_integration_hub.connector_binding_index
  FOR INSERT TO sf_app WITH CHECK (tenant_id = sf_platform.current_tenant_id());
CREATE POLICY connector_binding_index_update ON sf_integration_hub.connector_binding_index
  FOR UPDATE TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON sf_integration_hub.connector_definition TO sf_cmp037_rw;
GRANT SELECT, INSERT, UPDATE ON sf_integration_hub.connector_binding TO sf_cmp037_rw;
GRANT SELECT, INSERT, UPDATE ON sf_integration_hub.connector_transaction TO sf_cmp037_rw;
GRANT SELECT, INSERT, UPDATE ON sf_integration_hub.connector_binding_index TO sf_cmp037_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA sf_integration_hub TO sf_cmp037_rw;

REVOKE ALL ON sf_integration_hub.connector_definition FROM PUBLIC;
REVOKE ALL ON sf_integration_hub.connector_binding FROM PUBLIC;
REVOKE ALL ON sf_integration_hub.connector_transaction FROM PUBLIC;
REVOKE ALL ON sf_integration_hub.connector_binding_index FROM PUBLIC;

ALTER TABLE sf_integration_hub.connector_definition OWNER TO sf_migrator;
ALTER TABLE sf_integration_hub.connector_binding OWNER TO sf_migrator;
ALTER TABLE sf_integration_hub.connector_transaction OWNER TO sf_migrator;
ALTER TABLE sf_integration_hub.connector_binding_index OWNER TO sf_migrator;
ALTER SCHEMA sf_integration_hub OWNER TO sf_migrator;

-- Down Migration
DROP TABLE IF EXISTS sf_integration_hub.connector_binding_index;
DROP TABLE IF EXISTS sf_integration_hub.connector_transaction;
DROP TABLE IF EXISTS sf_integration_hub.connector_binding;
DROP TABLE IF EXISTS sf_integration_hub.connector_definition;
DROP SCHEMA IF EXISTS sf_integration_hub;
DROP ROLE IF EXISTS sf_cmp037_rw;
-- sf_migrator is shared across Wave 1; do not DROP it here.
