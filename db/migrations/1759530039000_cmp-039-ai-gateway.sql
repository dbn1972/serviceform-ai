-- CMP-039 AI Gateway (SF-M04-001). ADR-0006 Option A: sf_cmp039_rw NOLOGIN holds DML; FORCE RLS;
-- PUBLIC revoked; runtime is not table owner (sf_migrator).
-- Stores configuration (model pins, immutable policy versions) and append-only request METADATA
-- only. Raw prompts, model outputs and tool arguments are never persisted (AI-GOVERNANCE.md).
-- The gateway never records or issues a statutory eligibility/approval/rejection decision:
-- task kinds are an enumerated allowlist and audit rows are constrained advisory_only.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp039_rw') THEN
    CREATE ROLE sf_cmp039_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp039_rw IS
  'ADR-0006: CMP-039 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_ai_gateway AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_ai_gateway IS
  'isolation_class=TENANT_SCOPED; owner=CMP-039; model registry, AI policies, request metadata';

REVOKE ALL ON SCHEMA sf_ai_gateway FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_ai_gateway TO sf_cmp039_rw;
GRANT USAGE ON SCHEMA sf_ai_gateway TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_ai_gateway REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_ai_gateway REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_ai_gateway REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_ai_gateway.model_registry TENANT_SCOPED owner=CMP-039
CREATE TABLE sf_ai_gateway.model_registry (
  model_entry_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  provider_id text NOT NULL CHECK (provider_id ~ '^[a-z0-9][a-z0-9._-]{1,62}$'),
  model_id text NOT NULL CHECK (model_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  model_version text NOT NULL CHECK (
    model_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
    AND lower(model_version) NOT IN ('latest', 'default', 'stable', 'current')
  ),
  operations text[] NOT NULL CHECK (
    cardinality(operations) BETWEEN 1 AND 2 AND operations <@ ARRAY['INVOKE', 'EMBED']::text[]
  ),
  max_data_classification text NOT NULL CHECK (
    max_data_classification IN ('PUBLIC', 'INTERNAL', 'PERSONAL', 'SENSITIVE')
  ),
  max_input_chars integer NOT NULL CHECK (max_input_chars BETWEEN 1 AND 200000),
  max_output_tokens integer NOT NULL CHECK (max_output_tokens BETWEEN 1 AND 32000),
  daily_token_budget bigint NOT NULL CHECK (daily_token_budget > 0),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  registered_by uuid NOT NULL,
  revoked_by uuid,
  revoke_reason text CHECK (revoke_reason IS NULL OR char_length(revoke_reason) BETWEEN 1 AND 1000),
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (tenant_id, model_entry_id),
  CHECK (status <> 'REVOKED' OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);
CREATE UNIQUE INDEX model_registry_active_pin_uidx
  ON sf_ai_gateway.model_registry (tenant_id, provider_id, model_id, model_version)
  WHERE status = 'ACTIVE';
ALTER TABLE sf_ai_gateway.model_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_ai_gateway.model_registry FORCE ROW LEVEL SECURITY;
CREATE POLICY model_registry_tenant ON sf_ai_gateway.model_registry TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_ai_gateway.model_registry OWNER TO sf_migrator;

CREATE FUNCTION sf_ai_gateway.enforce_model_pin() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'model registry entries are retained'
      USING ERRCODE = 'P0001', HINT = 'SF_PUBLISHED_IMMUTABLE';
  END IF;
  IF OLD.status = 'REVOKED'
     OR NEW.model_entry_id <> OLD.model_entry_id
     OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.provider_id <> OLD.provider_id
     OR NEW.model_id <> OLD.model_id
     OR NEW.model_version <> OLD.model_version
     OR NEW.operations <> OLD.operations
     OR NEW.max_data_classification <> OLD.max_data_classification
     OR NEW.max_input_chars <> OLD.max_input_chars
     OR NEW.max_output_tokens <> OLD.max_output_tokens
     OR NEW.daily_token_budget <> OLD.daily_token_budget
     OR NEW.registered_by <> OLD.registered_by THEN
    RAISE EXCEPTION 'model pin is immutable; register a new entry'
      USING ERRCODE = 'P0001', HINT = 'SF_PUBLISHED_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_ai_gateway.enforce_model_pin() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_ai_gateway.enforce_model_pin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_ai_gateway.enforce_model_pin() TO sf_app, sf_cmp039_rw;
CREATE TRIGGER model_registry_pin_immutable
  BEFORE UPDATE OR DELETE ON sf_ai_gateway.model_registry
  FOR EACH ROW
  EXECUTE FUNCTION sf_ai_gateway.enforce_model_pin();

-- sf:isolation sf_ai_gateway.ai_policy TENANT_SCOPED owner=CMP-039
CREATE TABLE sf_ai_gateway.ai_policy (
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  policy_id text NOT NULL CHECK (policy_id ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  policy_version integer NOT NULL CHECK (policy_version >= 1),
  task_kind text NOT NULL CHECK (
    task_kind IN (
      'DRAFT', 'EXTRACT', 'SUMMARIZE', 'EXPLAIN', 'RECOMMEND_NON_BINDING',
      'GENERATE_TESTS', 'ASSIST_OFFICIAL', 'EMBED'
    )
  ),
  operation text NOT NULL CHECK (operation IN ('INVOKE', 'EMBED')),
  template_body text CHECK (template_body IS NULL OR char_length(template_body) BETWEEN 1 AND 16000),
  template_hash text NOT NULL CHECK (template_hash ~ '^sha256:[0-9a-f]{64}$'),
  variable_names text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(variable_names) <= 32),
  allowed_tools jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(allowed_tools) = 'array' AND octet_length(allowed_tools::text) <= 4096
  ),
  model_entry_ids uuid[] NOT NULL CHECK (cardinality(model_entry_ids) BETWEEN 1 AND 5),
  max_data_classification text NOT NULL CHECK (
    max_data_classification IN ('PUBLIC', 'INTERNAL', 'PERSONAL', 'SENSITIVE')
  ),
  max_output_tokens integer NOT NULL CHECK (max_output_tokens BETWEEN 1 AND 32000),
  latency_budget_ms integer NOT NULL CHECK (latency_budget_ms BETWEEN 100 AND 120000),
  fallback_behavior text NOT NULL CHECK (fallback_behavior IN ('DENY', 'NON_AI_PATH')),
  evaluation_ref jsonb NOT NULL CHECK (
    jsonb_typeof(evaluation_ref) = 'object'
    AND evaluation_ref ?& ARRAY['dataset_id', 'dataset_version', 'threshold', 'result']
    AND evaluation_ref ->> 'result' = 'PASSED'
    AND octet_length(evaluation_ref::text) <= 2048
  ),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  registered_by uuid NOT NULL,
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  PRIMARY KEY (tenant_id, policy_id, policy_version),
  CHECK (operation <> 'INVOKE' OR template_body IS NOT NULL),
  CHECK (operation <> 'EMBED' OR (template_body IS NULL AND task_kind = 'EMBED')),
  CHECK (task_kind <> 'EMBED' OR operation = 'EMBED'),
  CHECK (status <> 'RETIRED' OR retired_at IS NOT NULL)
);
ALTER TABLE sf_ai_gateway.ai_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_ai_gateway.ai_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_policy_tenant ON sf_ai_gateway.ai_policy TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_ai_gateway.ai_policy OWNER TO sf_migrator;

CREATE FUNCTION sf_ai_gateway.enforce_policy_version_immutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI policy versions are retained'
      USING ERRCODE = 'P0001', HINT = 'SF_PUBLISHED_IMMUTABLE';
  END IF;
  IF OLD.status = 'RETIRED'
     OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.policy_id <> OLD.policy_id
     OR NEW.policy_version <> OLD.policy_version
     OR NEW.task_kind <> OLD.task_kind
     OR NEW.operation <> OLD.operation
     OR NEW.template_body IS DISTINCT FROM OLD.template_body
     OR NEW.template_hash <> OLD.template_hash
     OR NEW.variable_names <> OLD.variable_names
     OR NEW.allowed_tools <> OLD.allowed_tools
     OR NEW.model_entry_ids <> OLD.model_entry_ids
     OR NEW.max_data_classification <> OLD.max_data_classification
     OR NEW.max_output_tokens <> OLD.max_output_tokens
     OR NEW.latency_budget_ms <> OLD.latency_budget_ms
     OR NEW.fallback_behavior <> OLD.fallback_behavior
     OR NEW.evaluation_ref <> OLD.evaluation_ref
     OR NEW.registered_by <> OLD.registered_by THEN
    RAISE EXCEPTION 'published AI policy version is immutable; register a new version'
      USING ERRCODE = 'P0001', HINT = 'SF_PUBLISHED_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_ai_gateway.enforce_policy_version_immutable() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_ai_gateway.enforce_policy_version_immutable() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_ai_gateway.enforce_policy_version_immutable() TO sf_app, sf_cmp039_rw;
CREATE TRIGGER ai_policy_version_immutable
  BEFORE UPDATE OR DELETE ON sf_ai_gateway.ai_policy
  FOR EACH ROW
  EXECUTE FUNCTION sf_ai_gateway.enforce_policy_version_immutable();

-- sf:isolation sf_ai_gateway.ai_request_metadata TENANT_SCOPED owner=CMP-039
CREATE TABLE sf_ai_gateway.ai_request_metadata (
  request_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  actor_type text NOT NULL,
  actor_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  trace_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INVOKE', 'EMBED')),
  policy_id text NOT NULL CHECK (policy_id ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  policy_version integer CHECK (policy_version IS NULL OR policy_version >= 1),
  caller_component text CHECK (caller_component IS NULL OR caller_component ~ '^CMP-0[0-9]{2}$'),
  policy_hash text CHECK (policy_hash IS NULL OR policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  prompt_hash text CHECK (prompt_hash IS NULL OR prompt_hash ~ '^sha256:[0-9a-f]{64}$'),
  provider_id text,
  model_id text,
  model_version text,
  tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(tool_calls) = 'array' AND octet_length(tool_calls::text) <= 4096
  ),
  citations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(citations) = 'array' AND octet_length(citations::text) <= 4096
  ),
  data_classification text NOT NULL CHECK (
    data_classification IN ('PUBLIC', 'INTERNAL', 'PERSONAL', 'SENSITIVE')
  ),
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 200),
  redaction_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(redaction_summary) = 'object' AND octet_length(redaction_summary::text) <= 1024
  ),
  outcome text NOT NULL CHECK (outcome IN ('COMPLETED', 'BLOCKED', 'FAILED')),
  reason_code text CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  fallback_used boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  latency_ms integer NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  simulated boolean NOT NULL,
  advisory_only boolean NOT NULL DEFAULT true CHECK (advisory_only),
  statutory_decision boolean NOT NULL DEFAULT false CHECK (NOT statutory_decision),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, request_id),
  CHECK (outcome = 'COMPLETED' OR reason_code IS NOT NULL)
);
CREATE INDEX ai_request_metadata_budget_idx
  ON sf_ai_gateway.ai_request_metadata (tenant_id, provider_id, model_id, model_version, created_at)
  WHERE outcome = 'COMPLETED';
CREATE INDEX ai_request_metadata_tenant_time_idx
  ON sf_ai_gateway.ai_request_metadata (tenant_id, created_at);
ALTER TABLE sf_ai_gateway.ai_request_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_ai_gateway.ai_request_metadata FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_request_metadata_tenant ON sf_ai_gateway.ai_request_metadata TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_ai_gateway.ai_request_metadata OWNER TO sf_migrator;

CREATE FUNCTION sf_ai_gateway.deny_request_metadata_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'AI request metadata is append-only'
    USING ERRCODE = 'P0001', HINT = 'SF_PUBLISHED_IMMUTABLE';
END
$$;
ALTER FUNCTION sf_ai_gateway.deny_request_metadata_mutation() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_ai_gateway.deny_request_metadata_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_ai_gateway.deny_request_metadata_mutation() TO sf_app, sf_cmp039_rw;
CREATE TRIGGER ai_request_metadata_append_only
  BEFORE UPDATE OR DELETE ON sf_ai_gateway.ai_request_metadata
  FOR EACH ROW
  EXECUTE FUNCTION sf_ai_gateway.deny_request_metadata_mutation();

-- sf:isolation sf_ai_gateway.idempotency_record TENANT_SCOPED owner=CMP-039
CREATE TABLE sf_ai_gateway.idempotency_record (
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
ALTER TABLE sf_ai_gateway.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_ai_gateway.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_tenant ON sf_ai_gateway.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_ai_gateway.idempotency_record OWNER TO sf_migrator;

GRANT SELECT, INSERT, UPDATE (
  status, revoked_by, revoke_reason, aggregate_version, revoked_at
) ON sf_ai_gateway.model_registry TO sf_cmp039_rw;
GRANT SELECT, INSERT, UPDATE (
  status, aggregate_version, retired_at
) ON sf_ai_gateway.ai_policy TO sf_cmp039_rw;
GRANT SELECT, INSERT ON sf_ai_gateway.ai_request_metadata TO sf_cmp039_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (
  status, response_ref, response_status, response_body
) ON sf_ai_gateway.idempotency_record TO sf_cmp039_rw;

REVOKE ALL ON sf_ai_gateway.model_registry FROM PUBLIC;
REVOKE ALL ON sf_ai_gateway.ai_policy FROM PUBLIC;
REVOKE ALL ON sf_ai_gateway.ai_request_metadata FROM PUBLIC;
REVOKE ALL ON sf_ai_gateway.idempotency_record FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS ai_request_metadata_append_only ON sf_ai_gateway.ai_request_metadata;
DROP TRIGGER IF EXISTS ai_policy_version_immutable ON sf_ai_gateway.ai_policy;
DROP TRIGGER IF EXISTS model_registry_pin_immutable ON sf_ai_gateway.model_registry;
DROP FUNCTION IF EXISTS sf_ai_gateway.deny_request_metadata_mutation();
DROP FUNCTION IF EXISTS sf_ai_gateway.enforce_policy_version_immutable();
DROP FUNCTION IF EXISTS sf_ai_gateway.enforce_model_pin();
DROP TABLE IF EXISTS sf_ai_gateway.idempotency_record;
DROP TABLE IF EXISTS sf_ai_gateway.ai_request_metadata;
DROP TABLE IF EXISTS sf_ai_gateway.ai_policy;
DROP TABLE IF EXISTS sf_ai_gateway.model_registry;
DROP SCHEMA IF EXISTS sf_ai_gateway;
-- Role sf_cmp039_rw retained (may be referenced by runtime logins); never DROP ROLE here.
