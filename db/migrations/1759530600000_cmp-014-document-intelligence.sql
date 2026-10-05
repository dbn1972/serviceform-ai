-- CMP-014 Document Intelligence / OCR (SF-M04-006). ADR-0006 Option A: sf_cmp014_rw NOLOGIN
-- holds DML; FORCE RLS; PUBLIC revoked; runtime is not table owner (sf_migrator).
-- Extraction is assistive only: CHECK constraints forbid statutory_decision and require
-- advisory_only. Raw document bytes are never stored (Constitution #5). All model inference
-- is invoked through CMP-039; this schema stores hashes, pins and assistive field payloads.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp014_rw') THEN
    CREATE ROLE sf_cmp014_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp014_rw IS
  'ADR-0006: CMP-014 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_docintel AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_docintel IS
  'isolation_class=TENANT_SCOPED; owner=CMP-014; assistive OCR/classification/extraction jobs';

REVOKE ALL ON SCHEMA sf_docintel FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_docintel TO sf_cmp014_rw;
GRANT USAGE ON SCHEMA sf_docintel TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_docintel REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_docintel REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_docintel REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_docintel.extraction_policy TENANT_SCOPED owner=CMP-014
CREATE TABLE sf_docintel.extraction_policy (
  tenant_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  policy_code text NOT NULL CHECK (policy_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  version_no bigint NOT NULL CHECK (version_no >= 1),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  allowed_content_types text[] NOT NULL
    CHECK (cardinality(allowed_content_types) BETWEEN 1 AND 16),
  min_confidence numeric(4,3) NOT NULL CHECK (min_confidence >= 0 AND min_confidence <= 1),
  max_excerpt_chars integer NOT NULL CHECK (max_excerpt_chars BETWEEN 32 AND 20000),
  gateway_policy_id text NOT NULL CHECK (gateway_policy_id ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  gateway_policy_version integer NOT NULL CHECK (gateway_policy_version >= 1),
  latency_budget_ms integer NOT NULL CHECK (latency_budget_ms BETWEEN 100 AND 120000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, policy_id),
  UNIQUE (tenant_id, policy_code, version_no)
);
ALTER TABLE sf_docintel.extraction_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_docintel.extraction_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY extraction_policy_isolation ON sf_docintel.extraction_policy TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_docintel.extraction_policy OWNER TO sf_migrator;

-- sf:isolation sf_docintel.intelligence_job TENANT_SCOPED owner=CMP-014
CREATE TABLE sf_docintel.intelligence_job (
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  policy_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  source_checksum_sha256 text NOT NULL CHECK (source_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  source_content_type text NOT NULL CHECK (char_length(source_content_type) BETWEEN 3 AND 100),
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 200),
  data_classification text NOT NULL CHECK (
    data_classification IN ('PUBLIC', 'INTERNAL', 'PERSONAL', 'SENSITIVE')
  ),
  status text NOT NULL CHECK (status IN (
    'ACCEPTED', 'CLASSIFYING', 'EXTRACTING', 'COMPLETED', 'NEEDS_REVIEW',
    'REVIEWED', 'FAILED', 'REJECTED'
  )),
  document_class text CHECK (
    document_class IS NULL OR document_class IN (
      'UNKNOWN', 'IDENTITY_DOCUMENT', 'ADDRESS_PROOF', 'GENERIC'
    )
  ),
  class_confidence numeric(4,3) CHECK (class_confidence IS NULL OR (class_confidence >= 0 AND class_confidence <= 1)),
  overall_confidence numeric(4,3) CHECK (overall_confidence IS NULL OR (overall_confidence >= 0 AND overall_confidence <= 1)),
  ocr_text_hash text CHECK (ocr_text_hash IS NULL OR ocr_text_hash ~ '^sha256:[0-9a-f]{64}$'),
  ocr_confidence numeric(4,3) CHECK (ocr_confidence IS NULL OR (ocr_confidence >= 0 AND ocr_confidence <= 1)),
  redaction_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(redaction_summary) = 'object' AND octet_length(redaction_summary::text) <= 1024
  ),
  extracted_fields jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(extracted_fields) = 'array' AND octet_length(extracted_fields::text) <= 65536
  ),
  provider_id text,
  model_id text,
  model_version text,
  prompt_id text,
  prompt_version integer CHECK (prompt_version IS NULL OR prompt_version >= 1),
  prompt_hash text CHECK (prompt_hash IS NULL OR prompt_hash ~ '^sha256:[0-9a-f]{64}$'),
  gateway_request_id uuid,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(provenance) = 'object' AND octet_length(provenance::text) <= 8192
  ),
  rejection_code text CHECK (rejection_code IS NULL OR rejection_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  review_decision text CHECK (
    review_decision IS NULL OR review_decision IN ('CONFIRM_ASSISTIVE', 'DISCARD')
  ),
  reviewed_by uuid,
  reviewed_at timestamptz,
  ocr_mode text NOT NULL CHECK (ocr_mode IN ('SIMULATED')),
  simulation jsonb,
  advisory_only boolean NOT NULL DEFAULT true CHECK (advisory_only),
  statutory_decision boolean NOT NULL DEFAULT false CHECK (NOT statutory_decision),
  evidence_satisfied boolean NOT NULL DEFAULT false CHECK (NOT evidence_satisfied),
  entitlement_issued boolean NOT NULL DEFAULT false CHECK (NOT entitlement_issued),
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, job_id),
  FOREIGN KEY (tenant_id, policy_id) REFERENCES sf_docintel.extraction_policy (tenant_id, policy_id),
  CHECK (status NOT IN ('REJECTED', 'FAILED') OR rejection_code IS NOT NULL),
  CHECK (ocr_mode <> 'SIMULATED' OR simulation IS NOT NULL),
  CHECK (
    (status <> 'REVIEWED')
    OR (review_decision IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);
CREATE INDEX intelligence_job_source_idx
  ON sf_docintel.intelligence_job (tenant_id, source_document_id);
ALTER TABLE sf_docintel.intelligence_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_docintel.intelligence_job FORCE ROW LEVEL SECURITY;
CREATE POLICY intelligence_job_isolation ON sf_docintel.intelligence_job TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_docintel.intelligence_job OWNER TO sf_migrator;

-- sf:isolation sf_docintel.idempotency_record TENANT_SCOPED owner=CMP-014
CREATE TABLE sf_docintel.idempotency_record (
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
ALTER TABLE sf_docintel.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_docintel.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_docintel.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_docintel.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_docintel.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_docintel, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'insert-only document intelligence row'
    USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_docintel.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER extraction_policy_immutable
  BEFORE UPDATE OR DELETE ON sf_docintel.extraction_policy
  FOR EACH ROW
  EXECUTE FUNCTION sf_docintel.reject_mutation();

CREATE FUNCTION sf_docintel.guard_job_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_docintel, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'intelligence jobs are retained' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ACCEPTED' THEN
      RAISE EXCEPTION 'intelligence job must start ACCEPTED';
    END IF;
    IF NEW.advisory_only IS NOT TRUE OR NEW.statutory_decision IS NOT FALSE THEN
      RAISE EXCEPTION 'AI output is assistive only';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.job_id IS DISTINCT FROM OLD.job_id
     OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
     OR NEW.source_checksum_sha256 IS DISTINCT FROM OLD.source_checksum_sha256
     OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
     OR NEW.advisory_only IS DISTINCT FROM TRUE
     OR NEW.statutory_decision IS DISTINCT FROM FALSE
     OR NEW.evidence_satisfied IS DISTINCT FROM FALSE
     OR NEW.entitlement_issued IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'intelligence job identity/decision boundary is immutable' USING ERRCODE = '42501';
  END IF;
  IF NOT (
       (OLD.status = 'ACCEPTED' AND NEW.status IN ('CLASSIFYING', 'REJECTED', 'FAILED'))
    OR (OLD.status = 'CLASSIFYING' AND NEW.status IN ('EXTRACTING', 'FAILED'))
    OR (OLD.status = 'EXTRACTING' AND NEW.status IN ('COMPLETED', 'NEEDS_REVIEW', 'FAILED'))
    OR (OLD.status = 'NEEDS_REVIEW' AND NEW.status = 'REVIEWED')
  ) THEN
    RAISE EXCEPTION 'intelligence job transition % -> % refused', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_docintel.guard_job_transition() OWNER TO sf_migrator;

CREATE TRIGGER intelligence_job_transition_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_docintel.intelligence_job
  FOR EACH ROW
  EXECUTE FUNCTION sf_docintel.guard_job_transition();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_docintel FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_docintel FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_docintel FROM PUBLIC;

GRANT SELECT, INSERT ON sf_docintel.extraction_policy TO sf_cmp014_rw;
GRANT SELECT, INSERT,
  UPDATE (
    status, document_class, class_confidence, overall_confidence, ocr_text_hash, ocr_confidence,
    redaction_summary, extracted_fields, provider_id, model_id, model_version, prompt_id,
    prompt_version, prompt_hash, gateway_request_id, provenance, rejection_code,
    review_decision, reviewed_by, reviewed_at, aggregate_version, updated_at
  )
  ON sf_docintel.intelligence_job TO sf_cmp014_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_docintel.idempotency_record TO sf_cmp014_rw;

GRANT EXECUTE ON FUNCTION sf_docintel.reject_mutation() TO sf_cmp014_rw;
GRANT EXECUTE ON FUNCTION sf_docintel.guard_job_transition() TO sf_cmp014_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_docintel FROM sf_cmp014_rw;
REVOKE ALL ON SCHEMA sf_docintel FROM sf_app;
DROP SCHEMA IF EXISTS sf_docintel CASCADE;
-- Role sf_cmp014_rw retained (may be referenced by runtime logins); never DROP ROLE here.
