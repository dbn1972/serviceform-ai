-- CMP-035 Search & Indexing (SF-M08-001). ADR-0006 Option A: sf_cmp035_rw NOLOGIN holds DML;
-- FORCE RLS; PUBLIC revoked; runtime is not table owner (sf_migrator).
-- Projection only: rows are derived from source-component events (consumed via CMP-038) and keep
-- the source component, source record id and source aggregate_version. The source stays
-- authoritative; nothing here is written back. Facets are declared by published projection
-- metadata; raw event payloads are never stored. No cross-component SQL.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp035_rw') THEN
    CREATE ROLE sf_cmp035_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp035_rw IS
  'ADR-0006: CMP-035 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_search AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_search IS
  'isolation_class=TENANT_SCOPED; owner=CMP-035; search index projections (non-authoritative)';

REVOKE ALL ON SCHEMA sf_search FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_search TO sf_cmp035_rw;
GRANT USAGE ON SCHEMA sf_search TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_search REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_search REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_search REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_search.search_document TENANT_SCOPED owner=CMP-035
CREATE TABLE sf_search.search_document (
  document_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  source_cmp_id text NOT NULL CHECK (source_cmp_id ~ '^CMP-[0-9]{3}$'),
  source_record_id uuid NOT NULL,
  source_aggregate_type text NOT NULL CHECK (source_aggregate_type ~ '^[A-Z][A-Za-z0-9]{1,63}$'),
  source_topic text NOT NULL CHECK (source_topic ~ '^[a-zA-Z0-9._-]{3,249}$'),
  source_version bigint NOT NULL CHECK (source_version >= 0),
  source_event_id uuid NOT NULL,
  source_event_type text NOT NULL CHECK (source_event_type ~ '^[A-Z][A-Za-z0-9]{2,79}$'),
  source_occurred_at timestamptz NOT NULL,
  projection_rule_id uuid NOT NULL,
  projection_rule_version integer NOT NULL CHECK (projection_rule_version >= 1),
  facets jsonb NOT NULL CHECK (
    jsonb_typeof(facets) = 'object' AND octet_length(facets::text) <= 16384
  ),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REMOVED')),
  revision bigint NOT NULL CHECK (revision >= 1),
  indexed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_correlation_id uuid NOT NULL,
  UNIQUE (tenant_id, document_id),
  UNIQUE (tenant_id, source_cmp_id, source_record_id),
  CHECK (status = 'ACTIVE' OR facets = '{}'::jsonb)
);
CREATE INDEX search_document_scan_idx
  ON sf_search.search_document (tenant_id, status, source_cmp_id, document_id);
CREATE INDEX search_document_facets_idx
  ON sf_search.search_document USING gin (facets jsonb_path_ops);
ALTER TABLE sf_search.search_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_search.search_document FORCE ROW LEVEL SECURITY;
CREATE POLICY search_document_tenant ON sf_search.search_document TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_search.search_document OWNER TO sf_migrator;

CREATE FUNCTION sf_search.enforce_search_document() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'search documents are tombstoned, never deleted by the runtime'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision <> 1 THEN
      RAISE EXCEPTION 'a search document is created at revision 1'
        USING ERRCODE = 'P0001', HINT = 'SF_STALE_VERSION';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.document_id, NEW.tenant_id, NEW.cell_id, NEW.source_cmp_id, NEW.source_record_id,
      NEW.source_aggregate_type, NEW.source_topic, NEW.indexed_at)
     IS DISTINCT FROM
     (OLD.document_id, OLD.tenant_id, OLD.cell_id, OLD.source_cmp_id, OLD.source_record_id,
      OLD.source_aggregate_type, OLD.source_topic, OLD.indexed_at) THEN
    RAISE EXCEPTION 'search document source identity is immutable'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'revision must advance by exactly one'
      USING ERRCODE = 'P0001', HINT = 'SF_STALE_VERSION';
  END IF;
  IF NEW.source_version <= OLD.source_version THEN
    RAISE EXCEPTION 'projection may only advance to a newer source version'
      USING ERRCODE = 'P0001', HINT = 'SF_STALE_VERSION';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_search.enforce_search_document() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_search.enforce_search_document() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_search.enforce_search_document() TO sf_cmp035_rw;

CREATE TRIGGER search_document_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_search.search_document
  FOR EACH ROW
  EXECUTE FUNCTION sf_search.enforce_search_document();

GRANT SELECT, INSERT ON sf_search.search_document TO sf_cmp035_rw;
GRANT UPDATE (
  source_version, source_event_id, source_event_type, source_occurred_at, projection_rule_id,
  projection_rule_version, facets, status, revision, updated_at, last_correlation_id
) ON sf_search.search_document TO sf_cmp035_rw;

REVOKE ALL ON sf_search.search_document FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS search_document_guard ON sf_search.search_document;
DROP FUNCTION IF EXISTS sf_search.enforce_search_document();
DROP TABLE IF EXISTS sf_search.search_document;
DROP SCHEMA IF EXISTS sf_search;
-- Role sf_cmp035_rw retained (may be referenced by runtime logins); never DROP ROLE here.
