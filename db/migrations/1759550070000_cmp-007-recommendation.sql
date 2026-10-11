-- CMP-007 Recommendation Engine (SF-M08-002). ADR-0006 Option A: sf_cmp007_rw NOLOGIN holds
-- DML; FORCE RLS; PUBLIC revoked; runtime is not table owner (sf_migrator).
-- Recommendations are NON_AUTHORITATIVE decision support (SF-CON-RECOMMENDATION): CHECK
-- constraints and a transition trigger forbid authoritative/statutory rows. Raw prompts and
-- model output text are never stored; only coded reasons, pins and hashes. All model calls go
-- through CMP-039; this schema holds no provider credentials.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp007_rw') THEN
    CREATE ROLE sf_cmp007_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp007_rw IS
  'ADR-0006: CMP-007 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_recommendation AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_recommendation IS
  'isolation_class=TENANT_SCOPED; owner=CMP-007; non-authoritative recommendations via CMP-039';

REVOKE ALL ON SCHEMA sf_recommendation FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_recommendation TO sf_cmp007_rw;
GRANT USAGE ON SCHEMA sf_recommendation TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_recommendation REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_recommendation REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_recommendation REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_recommendation.recommendation_policy TENANT_SCOPED owner=CMP-007
CREATE TABLE sf_recommendation.recommendation_policy (
  tenant_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  policy_code text NOT NULL CHECK (policy_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  version_no bigint NOT NULL CHECK (version_no >= 1),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  consent_purpose_code text NOT NULL CHECK (consent_purpose_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  gateway_policy_id text NOT NULL CHECK (gateway_policy_id ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  gateway_policy_version integer NOT NULL CHECK (gateway_policy_version >= 1),
  model_route_ref text NOT NULL CHECK (model_route_ref ~ '^[a-z0-9][a-z0-9._-]{2,127}$'),
  allowed_reason_codes text[] NOT NULL
    CHECK (cardinality(allowed_reason_codes) BETWEEN 1 AND 64),
  allowed_signal_codes text[] NOT NULL
    CHECK (cardinality(allowed_signal_codes) BETWEEN 0 AND 64),
  max_candidates integer NOT NULL CHECK (max_candidates BETWEEN 1 AND 50),
  max_results integer NOT NULL CHECK (max_results BETWEEN 1 AND 10),
  latency_budget_ms integer NOT NULL CHECK (latency_budget_ms BETWEEN 100 AND 120000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, policy_id),
  UNIQUE (tenant_id, policy_code, version_no),
  CHECK (max_results <= max_candidates)
);
ALTER TABLE sf_recommendation.recommendation_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_recommendation.recommendation_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY recommendation_policy_isolation ON sf_recommendation.recommendation_policy TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_recommendation.recommendation_policy OWNER TO sf_migrator;

-- sf:isolation sf_recommendation.recommendation TENANT_SCOPED owner=CMP-007
CREATE TABLE sf_recommendation.recommendation (
  tenant_id uuid NOT NULL,
  recommendation_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  subject_id uuid NOT NULL,
  application_id uuid,
  policy_id uuid NOT NULL,
  consent_purpose_code text NOT NULL CHECK (consent_purpose_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  consent_ref text CHECK (consent_ref IS NULL OR char_length(consent_ref) BETWEEN 1 AND 128),
  status text NOT NULL CHECK (status IN ('REQUESTED', 'GENERATED', 'FAILED', 'SELECTED', 'DISMISSED')),
  candidates jsonb NOT NULL CHECK (
    jsonb_typeof(candidates) = 'array' AND jsonb_array_length(candidates) BETWEEN 1 AND 50
    AND octet_length(candidates::text) <= 32768
  ),
  signals text[] NOT NULL DEFAULT '{}' CHECK (cardinality(signals) <= 32),
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 10
    AND octet_length(items::text) <= 16384
  ),
  reason_codes text[] NOT NULL DEFAULT '{}' CHECK (cardinality(reason_codes) <= 80),
  model_route_ref text NOT NULL CHECK (model_route_ref ~ '^[a-z0-9][a-z0-9._-]{2,127}$'),
  provider_id text,
  model_id text,
  model_version text,
  prompt_id text,
  prompt_version integer CHECK (prompt_version IS NULL OR prompt_version >= 1),
  prompt_hash text CHECK (prompt_hash IS NULL OR prompt_hash ~ '^sha256:[0-9a-f]{64}$'),
  gateway_request_id uuid,
  rejection_code text CHECK (rejection_code IS NULL OR rejection_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  disposition text CHECK (disposition IS NULL OR disposition IN ('SELECTED', 'DISMISSED')),
  selected_service_id uuid,
  disposed_by uuid,
  disposed_at timestamptz,
  correlation_id uuid NOT NULL,
  ai_gateway_cmp text NOT NULL DEFAULT 'CMP-039' CHECK (ai_gateway_cmp = 'CMP-039'),
  non_authoritative boolean NOT NULL DEFAULT true CHECK (non_authoritative),
  authoritative boolean NOT NULL DEFAULT false CHECK (NOT authoritative),
  statutory_decision boolean NOT NULL DEFAULT false CHECK (NOT statutory_decision),
  consent_recorded boolean NOT NULL DEFAULT true CHECK (consent_recorded),
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, recommendation_id),
  FOREIGN KEY (tenant_id, policy_id)
    REFERENCES sf_recommendation.recommendation_policy (tenant_id, policy_id),
  CHECK (status <> 'FAILED' OR rejection_code IS NOT NULL),
  CHECK (
    status NOT IN ('GENERATED', 'SELECTED', 'DISMISSED')
    OR (jsonb_array_length(items) >= 1 AND cardinality(reason_codes) >= 1
        AND provider_id IS NOT NULL AND model_id IS NOT NULL AND model_version IS NOT NULL
        AND prompt_hash IS NOT NULL)
  ),
  CHECK (
    status NOT IN ('SELECTED', 'DISMISSED')
    OR (disposition = status AND disposed_by IS NOT NULL AND disposed_at IS NOT NULL)
  ),
  CHECK (status <> 'SELECTED' OR selected_service_id IS NOT NULL)
);
CREATE INDEX recommendation_subject_idx
  ON sf_recommendation.recommendation (tenant_id, subject_id, created_at DESC);
ALTER TABLE sf_recommendation.recommendation ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_recommendation.recommendation FORCE ROW LEVEL SECURITY;
CREATE POLICY recommendation_isolation ON sf_recommendation.recommendation TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_recommendation.recommendation OWNER TO sf_migrator;

-- sf:isolation sf_recommendation.idempotency_record TENANT_SCOPED owner=CMP-007
CREATE TABLE sf_recommendation.idempotency_record (
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
ALTER TABLE sf_recommendation.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_recommendation.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_recommendation.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_recommendation.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_recommendation.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_recommendation, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'insert-only recommendation policy row'
    USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_recommendation.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER recommendation_policy_immutable
  BEFORE UPDATE OR DELETE ON sf_recommendation.recommendation_policy
  FOR EACH ROW
  EXECUTE FUNCTION sf_recommendation.reject_mutation();

CREATE FUNCTION sf_recommendation.guard_recommendation_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_recommendation, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'recommendations are retained' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'REQUESTED' THEN
      RAISE EXCEPTION 'recommendation must start REQUESTED';
    END IF;
    IF NEW.non_authoritative IS NOT TRUE OR NEW.authoritative IS NOT FALSE
       OR NEW.statutory_decision IS NOT FALSE THEN
      RAISE EXCEPTION 'recommendations are non-authoritative decision support';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.recommendation_id IS DISTINCT FROM OLD.recommendation_id
     OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
     OR NEW.candidates IS DISTINCT FROM OLD.candidates
     OR NEW.consent_purpose_code IS DISTINCT FROM OLD.consent_purpose_code
     OR NEW.model_route_ref IS DISTINCT FROM OLD.model_route_ref
     OR NEW.ai_gateway_cmp IS DISTINCT FROM OLD.ai_gateway_cmp
     OR NEW.non_authoritative IS DISTINCT FROM TRUE
     OR NEW.authoritative IS DISTINCT FROM FALSE
     OR NEW.statutory_decision IS DISTINCT FROM FALSE
     OR NEW.consent_recorded IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'recommendation identity/decision boundary is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'REQUESTED' AND (
       NEW.items IS DISTINCT FROM OLD.items
    OR NEW.reason_codes IS DISTINCT FROM OLD.reason_codes
    OR NEW.prompt_hash IS DISTINCT FROM OLD.prompt_hash
    OR NEW.gateway_request_id IS DISTINCT FROM OLD.gateway_request_id
    OR NEW.model_id IS DISTINCT FROM OLD.model_id
  ) THEN
    RAISE EXCEPTION 'generated recommendation content is immutable' USING ERRCODE = '42501';
  END IF;
  IF NOT (
       (OLD.status = 'REQUESTED' AND NEW.status IN ('GENERATED', 'FAILED'))
    OR (OLD.status = 'GENERATED' AND NEW.status IN ('SELECTED', 'DISMISSED'))
  ) THEN
    RAISE EXCEPTION 'recommendation transition % -> % refused', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_recommendation.guard_recommendation_transition() OWNER TO sf_migrator;

CREATE TRIGGER recommendation_transition_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_recommendation.recommendation
  FOR EACH ROW
  EXECUTE FUNCTION sf_recommendation.guard_recommendation_transition();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_recommendation FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_recommendation FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_recommendation FROM PUBLIC;

GRANT SELECT, INSERT ON sf_recommendation.recommendation_policy TO sf_cmp007_rw;
GRANT SELECT, INSERT,
  UPDATE (
    status, items, reason_codes, provider_id, model_id, model_version, prompt_id,
    prompt_version, prompt_hash, gateway_request_id, rejection_code, disposition,
    selected_service_id, disposed_by, disposed_at, aggregate_version, updated_at
  )
  ON sf_recommendation.recommendation TO sf_cmp007_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_recommendation.idempotency_record TO sf_cmp007_rw;

GRANT EXECUTE ON FUNCTION sf_recommendation.reject_mutation() TO sf_cmp007_rw;
GRANT EXECUTE ON FUNCTION sf_recommendation.guard_recommendation_transition() TO sf_cmp007_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_recommendation FROM sf_cmp007_rw;
REVOKE ALL ON SCHEMA sf_recommendation FROM sf_app;
DROP SCHEMA IF EXISTS sf_recommendation CASCADE;
-- Role sf_cmp007_rw retained (may be referenced by runtime logins); never DROP ROLE here.
