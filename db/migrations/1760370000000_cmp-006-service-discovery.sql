-- CMP-006 Service Discovery Engine (SF-M08-006). ADR-0006 Option A: sf_cmp006_rw NOLOGIN holds DML;
-- FORCE RLS; PUBLIC revoked; runtime is not the table owner (sf_migrator).
-- Stores CMP-006's own query log only (SF-CON-DISCOVERY-QUERY pins and filters, never raw keyword
-- text), the catalogue-verified result rows, and citizen selections that hand off to INT-003.
-- Results are catalogue/search projections, never statutory decisions: result_is_non_statutory is
-- constant true and draft_created constant false. Nothing here creates a form, draft or application.
-- No retention period is defined here; retention of these rows is governed by CMP-049 owner input.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp006_rw') THEN
    CREATE ROLE sf_cmp006_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp006_rw IS
  'ADR-0006: CMP-006 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_discovery AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_discovery IS
  'isolation_class=TENANT_SCOPED; owner=CMP-006; discovery query log, verified results, citizen selections';

REVOKE ALL ON SCHEMA sf_discovery FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_discovery TO sf_cmp006_rw;
GRANT USAGE ON SCHEMA sf_discovery TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_discovery REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_discovery REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_discovery REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- Opaque master-data codes (catalogue / jurisdiction). Matched only, never interpreted.
CREATE FUNCTION sf_discovery.codes_valid(codes text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = sf_discovery, pg_temp
AS $$
  SELECT array_position(codes, NULL) IS NULL
     AND coalesce(bool_and(c ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'), true)
    FROM unnest(codes) AS c
$$;
ALTER FUNCTION sf_discovery.codes_valid(text[]) OWNER TO sf_migrator;

-- sf:isolation sf_discovery.discovery_query TENANT_SCOPED owner=CMP-006
CREATE TABLE sf_discovery.discovery_query (
  tenant_id uuid NOT NULL,
  query_id uuid NOT NULL,
  contract_id text NOT NULL DEFAULT 'SF-CON-DISCOVERY-QUERY'
    CHECK (contract_id = 'SF-CON-DISCOVERY-QUERY'),
  actor_type text NOT NULL CHECK (actor_type IN ('CITIZEN', 'OFFICER', 'PRIVILEGED_ADMIN', 'SYSTEM')),
  actor_id uuid NOT NULL,
  catalogue_version_id uuid NOT NULL,
  jurisdiction_codes text[] NOT NULL CHECK (
    cardinality(jurisdiction_codes) BETWEEN 1 AND 16 AND sf_discovery.codes_valid(jurisdiction_codes)
  ),
  service_codes text[] NOT NULL DEFAULT '{}' CHECK (
    cardinality(service_codes) <= 32 AND sf_discovery.codes_valid(service_codes)
  ),
  keyword_count integer NOT NULL CHECK (keyword_count BETWEEN 0 AND 8),
  pagination_limit integer NOT NULL CHECK (pagination_limit BETWEEN 1 AND 100),
  pagination_offset integer NOT NULL CHECK (pagination_offset BETWEEN 0 AND 10000),
  result_count integer NOT NULL CHECK (result_count >= 0),
  excluded_count integer NOT NULL CHECK (excluded_count >= 0),
  has_more boolean NOT NULL,
  result_is_non_statutory boolean NOT NULL DEFAULT true CHECK (result_is_non_statutory),
  draft_created boolean NOT NULL DEFAULT false CHECK (NOT draft_created),
  created_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, query_id),
  UNIQUE (tenant_id, query_id, catalogue_version_id),
  UNIQUE (tenant_id, query_id, actor_type, actor_id),
  CHECK (result_count + excluded_count <= pagination_limit)
);
CREATE INDEX discovery_query_actor_idx
  ON sf_discovery.discovery_query (tenant_id, actor_id, created_at);
ALTER TABLE sf_discovery.discovery_query ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_discovery.discovery_query FORCE ROW LEVEL SECURITY;
CREATE POLICY discovery_query_isolation ON sf_discovery.discovery_query TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_discovery.discovery_query OWNER TO sf_migrator;

-- sf:isolation sf_discovery.discovery_result TENANT_SCOPED owner=CMP-006
CREATE TABLE sf_discovery.discovery_result (
  tenant_id uuid NOT NULL,
  query_id uuid NOT NULL,
  rank integer NOT NULL CHECK (rank BETWEEN 1 AND 100),
  service_id uuid NOT NULL,
  service_code text NOT NULL CHECK (sf_discovery.codes_valid(ARRAY[service_code])),
  category_code text CHECK (category_code IS NULL OR sf_discovery.codes_valid(ARRAY[category_code])),
  service_binding_version_id uuid NOT NULL,
  catalogue_version_id uuid NOT NULL,
  matched_jurisdiction_codes text[] NOT NULL CHECK (
    cardinality(matched_jurisdiction_codes) >= 1
    AND sf_discovery.codes_valid(matched_jurisdiction_codes)
  ),
  PRIMARY KEY (tenant_id, query_id, rank),
  UNIQUE (tenant_id, query_id, service_id),
  UNIQUE (tenant_id, query_id, service_id, service_code, service_binding_version_id, catalogue_version_id),
  FOREIGN KEY (tenant_id, query_id, catalogue_version_id)
    REFERENCES sf_discovery.discovery_query (tenant_id, query_id, catalogue_version_id)
);
ALTER TABLE sf_discovery.discovery_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_discovery.discovery_result FORCE ROW LEVEL SECURITY;
CREATE POLICY discovery_result_isolation ON sf_discovery.discovery_result TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_discovery.discovery_result OWNER TO sf_migrator;

-- sf:isolation sf_discovery.discovery_selection TENANT_SCOPED owner=CMP-006
-- INT-003 hand-off: a citizen may select only a result of a query that same citizen ran, with the
-- exact catalogue and TenantServiceBinding pins recorded on that result (composite FKs).
CREATE TABLE sf_discovery.discovery_selection (
  tenant_id uuid NOT NULL,
  selection_id uuid NOT NULL,
  query_id uuid NOT NULL,
  service_id uuid NOT NULL,
  service_code text NOT NULL,
  service_binding_version_id uuid NOT NULL,
  catalogue_version_id uuid NOT NULL,
  actor_type text NOT NULL CHECK (actor_type = 'CITIZEN'),
  actor_id uuid NOT NULL,
  result_is_non_statutory boolean NOT NULL DEFAULT true CHECK (result_is_non_statutory),
  draft_created boolean NOT NULL DEFAULT false CHECK (NOT draft_created),
  selected_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, selection_id),
  UNIQUE (tenant_id, query_id, service_id),
  FOREIGN KEY (tenant_id, query_id, actor_type, actor_id)
    REFERENCES sf_discovery.discovery_query (tenant_id, query_id, actor_type, actor_id),
  FOREIGN KEY (tenant_id, query_id, service_id, service_code, service_binding_version_id, catalogue_version_id)
    REFERENCES sf_discovery.discovery_result (
      tenant_id, query_id, service_id, service_code, service_binding_version_id, catalogue_version_id
    )
);
ALTER TABLE sf_discovery.discovery_selection ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_discovery.discovery_selection FORCE ROW LEVEL SECURITY;
CREATE POLICY discovery_selection_isolation ON sf_discovery.discovery_selection TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_discovery.discovery_selection OWNER TO sf_migrator;

-- sf:isolation sf_discovery.idempotency_record TENANT_SCOPED owner=CMP-006
CREATE TABLE sf_discovery.idempotency_record (
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
ALTER TABLE sf_discovery.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_discovery.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_discovery.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_discovery.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_discovery.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_discovery, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'insert-only discovery row' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_discovery.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER discovery_query_immutable
  BEFORE UPDATE OR DELETE ON sf_discovery.discovery_query
  FOR EACH ROW EXECUTE FUNCTION sf_discovery.reject_mutation();
CREATE TRIGGER discovery_result_immutable
  BEFORE UPDATE OR DELETE ON sf_discovery.discovery_result
  FOR EACH ROW EXECUTE FUNCTION sf_discovery.reject_mutation();
CREATE TRIGGER discovery_selection_immutable
  BEFORE UPDATE OR DELETE ON sf_discovery.discovery_selection
  FOR EACH ROW EXECUTE FUNCTION sf_discovery.reject_mutation();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_discovery FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_discovery FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_discovery FROM PUBLIC;

GRANT SELECT, INSERT ON sf_discovery.discovery_query TO sf_cmp006_rw;
GRANT SELECT, INSERT ON sf_discovery.discovery_result TO sf_cmp006_rw;
GRANT SELECT, INSERT ON sf_discovery.discovery_selection TO sf_cmp006_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_discovery.idempotency_record TO sf_cmp006_rw;

GRANT EXECUTE ON FUNCTION sf_discovery.codes_valid(text[]) TO sf_cmp006_rw;
GRANT EXECUTE ON FUNCTION sf_discovery.reject_mutation() TO sf_cmp006_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_discovery FROM sf_cmp006_rw;
REVOKE ALL ON SCHEMA sf_discovery FROM sf_app;
DROP SCHEMA IF EXISTS sf_discovery CASCADE;
-- Role sf_cmp006_rw retained (may be referenced by runtime logins); never DROP ROLE here.
