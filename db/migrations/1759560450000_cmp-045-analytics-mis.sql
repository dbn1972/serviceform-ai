-- CMP-045 Analytics & MIS (SF-M08-003). ADR-0006 Option A: sf_cmp045_rw NOLOGIN holds DML;
-- FORCE RLS; PUBLIC revoked; runtime is not the table owner (sf_migrator).
-- Projection and aggregation only: this schema stores published metric definitions and
-- tenant-scoped aggregate points derived from events. It holds no case, application or payment
-- state, no reference to any other component's table, and no raw event payload or person-level
-- value (SF-CON-ANALYTICS-METRIC: aggregate_only, raw_pii_payload_forbidden). Dimension values are
-- category codes enforced again here by guard_metric_point. Published definitions are immutable
-- (only PUBLISHED -> RETIRED). A rebuild writes a new generation beside the active one and swaps
-- atomically; only a non-active generation can be deleted. No retention period is defined here:
-- statutory retention belongs to CMP-049 (SF-M08-005, STATUTORY_RETENTION_POLICY_INPUT_REQUIRED).
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp045_rw') THEN
    CREATE ROLE sf_cmp045_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp045_rw IS
  'ADR-0006: CMP-045 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_analytics AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_analytics IS
  'isolation_class=TENANT_SCOPED; owner=CMP-045; metric definitions and tenant-scoped aggregate projection points';

REVOKE ALL ON SCHEMA sf_analytics FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_analytics TO sf_cmp045_rw;
GRANT USAGE ON SCHEMA sf_analytics TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_analytics REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_analytics REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_analytics REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- Shape rules shared by every guard below. IMMUTABLE and side-effect free.
CREATE FUNCTION sf_analytics.is_category_code(v text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT v ~ '^[A-Z0-9][A-Z0-9_.-]{0,63}$'
     AND v !~ '[0-9]{6,}'
     AND v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;
ALTER FUNCTION sf_analytics.is_category_code(text) OWNER TO sf_migrator;

-- Mirrors IDENTIFYING_TOKENS in src/domain/privacy.ts (equality is a contract test).
CREATE FUNCTION sf_analytics.is_identifying_field_name(v text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT string_to_array(lower(v), '_') && ARRAY[
    'id', 'uuid', 'guid', 'ref', 'token', 'secret', 'password', 'name', 'fname', 'lname',
    'firstname', 'lastname', 'fullname', 'email', 'mail', 'phone', 'mobile', 'msisdn', 'aadhaar',
    'aadhar', 'address', 'dob', 'birth', 'passport', 'voter', 'pan', 'ssn', 'account', 'ifsc', 'ip'
  ]
$$;
ALTER FUNCTION sf_analytics.is_identifying_field_name(text) OWNER TO sf_migrator;

-- sf:isolation sf_analytics.metric_definition TENANT_SCOPED owner=CMP-045
CREATE TABLE sf_analytics.metric_definition (
  tenant_id uuid NOT NULL,
  definition_id uuid NOT NULL,
  metric_code text NOT NULL CHECK (metric_code ~ '^[A-Z0-9][A-Z0-9_.-]{0,63}$'),
  version_no bigint NOT NULL CHECK (version_no >= 1),
  status text NOT NULL CHECK (status IN ('PUBLISHED', 'RETIRED')),
  publication_ref text NOT NULL CHECK (char_length(publication_ref) BETWEEN 3 AND 200),
  purpose_code text NOT NULL CHECK (purpose_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  source_event_type text NOT NULL CHECK (source_event_type ~ '^[A-Z][A-Za-z0-9]{2,79}$'),
  source_aggregate_type text CHECK (source_aggregate_type IS NULL OR source_aggregate_type ~ '^[A-Z][A-Za-z0-9]{1,63}$'),
  source_schema_version integer NOT NULL CHECK (source_schema_version >= 1),
  aggregation text NOT NULL CHECK (aggregation IN ('COUNT', 'SUM')),
  value_field text CHECK (value_field IS NULL OR value_field ~ '^[a-z][a-z0-9_]{1,63}$'),
  period_granularity text NOT NULL CHECK (period_granularity IN ('HOUR', 'DAY', 'WEEK', 'MONTH')),
  dimensions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(dimensions) = 'array'
    AND jsonb_array_length(dimensions) <= 6
    AND octet_length(dimensions::text) <= 8192
  ),
  min_cohort_size integer NOT NULL CHECK (min_cohort_size BETWEEN 1 AND 100000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  PRIMARY KEY (tenant_id, definition_id),
  UNIQUE (tenant_id, metric_code, version_no),
  CHECK ((aggregation = 'SUM') = (value_field IS NOT NULL)),
  CHECK (value_field IS NULL OR NOT sf_analytics.is_identifying_field_name(value_field)),
  CHECK ((status = 'RETIRED') = (retired_at IS NOT NULL))
);
CREATE INDEX metric_definition_event_idx
  ON sf_analytics.metric_definition (tenant_id, source_event_type) WHERE status = 'PUBLISHED';
ALTER TABLE sf_analytics.metric_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_analytics.metric_definition FORCE ROW LEVEL SECURITY;
CREATE POLICY metric_definition_isolation ON sf_analytics.metric_definition TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_analytics.metric_definition OWNER TO sf_migrator;

-- sf:isolation sf_analytics.projection_state TENANT_SCOPED owner=CMP-045
CREATE TABLE sf_analytics.projection_state (
  tenant_id uuid NOT NULL,
  definition_id uuid NOT NULL,
  active_generation integer NOT NULL CHECK (active_generation >= 1),
  building_generation integer CHECK (building_generation IS NULL OR building_generation > active_generation),
  build_token uuid,
  build_lease_expires_at timestamptz,
  last_rebuilt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, definition_id),
  FOREIGN KEY (tenant_id, definition_id) REFERENCES sf_analytics.metric_definition (tenant_id, definition_id),
  CHECK (
    (building_generation IS NULL AND build_token IS NULL AND build_lease_expires_at IS NULL)
    OR (building_generation IS NOT NULL AND build_token IS NOT NULL AND build_lease_expires_at IS NOT NULL)
  )
);
ALTER TABLE sf_analytics.projection_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_analytics.projection_state FORCE ROW LEVEL SECURITY;
CREATE POLICY projection_state_isolation ON sf_analytics.projection_state TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_analytics.projection_state OWNER TO sf_migrator;

-- sf:isolation sf_analytics.metric_point TENANT_SCOPED owner=CMP-045
CREATE TABLE sf_analytics.metric_point (
  tenant_id uuid NOT NULL,
  definition_id uuid NOT NULL,
  generation integer NOT NULL CHECK (generation >= 1),
  period_start timestamptz NOT NULL,
  dimension_hash text NOT NULL CHECK (dimension_hash ~ '^sha256:[0-9a-f]{64}$'),
  period_end timestamptz NOT NULL,
  metric_id uuid NOT NULL,
  metric_code text NOT NULL CHECK (metric_code ~ '^[A-Z0-9][A-Z0-9_.-]{0,63}$'),
  purpose_code text NOT NULL CHECK (purpose_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(dimensions) = 'object' AND octet_length(dimensions::text) <= 2048
  ),
  value numeric(24, 6) NOT NULL,
  contributor_count bigint NOT NULL CHECK (contributor_count >= 1),
  aggregate_only boolean NOT NULL DEFAULT true CHECK (aggregate_only),
  raw_pii_payload_forbidden boolean NOT NULL DEFAULT true CHECK (raw_pii_payload_forbidden),
  last_event_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, definition_id, generation, period_start, dimension_hash),
  FOREIGN KEY (tenant_id, definition_id) REFERENCES sf_analytics.metric_definition (tenant_id, definition_id),
  CHECK (period_end > period_start)
);
CREATE INDEX metric_point_read_idx ON sf_analytics.metric_point (tenant_id, definition_id, period_start);
ALTER TABLE sf_analytics.metric_point ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_analytics.metric_point FORCE ROW LEVEL SECURITY;
CREATE POLICY metric_point_isolation ON sf_analytics.metric_point TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_analytics.metric_point OWNER TO sf_migrator;

-- sf:isolation sf_analytics.projection_applied_event TENANT_SCOPED owner=CMP-045
-- Event identifiers only (dedupe key). No payload, actor or subject column exists.
CREATE TABLE sf_analytics.projection_applied_event (
  tenant_id uuid NOT NULL,
  definition_id uuid NOT NULL,
  generation integer NOT NULL CHECK (generation >= 1),
  event_id uuid NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, definition_id, generation, event_id),
  FOREIGN KEY (tenant_id, definition_id) REFERENCES sf_analytics.metric_definition (tenant_id, definition_id)
);
ALTER TABLE sf_analytics.projection_applied_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_analytics.projection_applied_event FORCE ROW LEVEL SECURITY;
CREATE POLICY projection_applied_event_isolation ON sf_analytics.projection_applied_event TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_analytics.projection_applied_event OWNER TO sf_migrator;

-- sf:isolation sf_analytics.idempotency_record TENANT_SCOPED owner=CMP-045
CREATE TABLE sf_analytics.idempotency_record (
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
ALTER TABLE sf_analytics.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_analytics.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_analytics.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_analytics.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_analytics.guard_definition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_analytics, pg_temp
AS $$
DECLARE
  dim jsonb;
  allowed jsonb;
  seen text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'published metric definitions are retained' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PUBLISHED' THEN
      RAISE EXCEPTION 'metric definition version must be inserted PUBLISHED';
    END IF;
    FOR dim IN SELECT value FROM jsonb_array_elements(NEW.dimensions) LOOP
      IF jsonb_typeof(dim) <> 'object'
         OR EXISTS (SELECT 1 FROM jsonb_object_keys(dim) k WHERE k NOT IN ('key', 'source_field', 'allowed_values'))
         OR jsonb_typeof(dim -> 'key') IS DISTINCT FROM 'string'
         OR jsonb_typeof(dim -> 'source_field') IS DISTINCT FROM 'string'
         OR (dim ->> 'key') !~ '^[a-z][a-z0-9_]{1,63}$'
         OR (dim ->> 'source_field') !~ '^[a-z][a-z0-9_]{1,63}$' THEN
        RAISE EXCEPTION 'metric definition dimension is malformed' USING ERRCODE = '23514';
      END IF;
      IF sf_analytics.is_identifying_field_name(dim ->> 'key')
         OR sf_analytics.is_identifying_field_name(dim ->> 'source_field') THEN
        RAISE EXCEPTION 'metric definition dimension names a personal or per-record identifier'
          USING ERRCODE = '23514';
      END IF;
      IF (dim ->> 'key') = ANY (seen) THEN
        RAISE EXCEPTION 'metric definition dimension keys must be unique' USING ERRCODE = '23514';
      END IF;
      seen := seen || (dim ->> 'key');
      allowed := dim -> 'allowed_values';
      IF allowed IS NOT NULL THEN
        IF jsonb_typeof(allowed) <> 'array' OR jsonb_array_length(allowed) > 200
           OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(allowed) a
              WHERE jsonb_typeof(a) <> 'string' OR NOT sf_analytics.is_category_code(a #>> '{}')
           ) THEN
          RAISE EXCEPTION 'metric definition allowed_values must be category codes' USING ERRCODE = '23514';
        END IF;
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;
  IF NOT (OLD.status = 'PUBLISHED' AND NEW.status = 'RETIRED') THEN
    RAISE EXCEPTION 'published metric definition is immutable' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'retired_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'retired_at') THEN
    RAISE EXCEPTION 'published metric definition content is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_analytics.guard_definition() OWNER TO sf_migrator;

CREATE TRIGGER metric_definition_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_analytics.metric_definition
  FOR EACH ROW EXECUTE FUNCTION sf_analytics.guard_definition();

CREATE FUNCTION sf_analytics.guard_projection_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_analytics, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'projection state is retained' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.active_generation <> 1 OR NEW.building_generation IS NOT NULL THEN
      RAISE EXCEPTION 'projection state must start at generation 1 with no build in progress';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.definition_id IS DISTINCT FROM OLD.definition_id THEN
    RAISE EXCEPTION 'projection state identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.active_generation <> OLD.active_generation
     AND NOT (OLD.building_generation IS NOT NULL AND NEW.active_generation = OLD.building_generation
              AND NEW.building_generation IS NULL) THEN
    RAISE EXCEPTION 'only the building generation can become active' USING ERRCODE = '42501';
  END IF;
  IF NEW.building_generation IS NOT NULL AND NEW.building_generation <> NEW.active_generation + 1 THEN
    RAISE EXCEPTION 'building generation must directly follow the active generation';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_analytics.guard_projection_state() OWNER TO sf_migrator;

CREATE TRIGGER projection_state_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_analytics.projection_state
  FOR EACH ROW EXECUTE FUNCTION sf_analytics.guard_projection_state();

-- Rows of the active generation are never deleted; only a superseded or abandoned generation is.
CREATE FUNCTION sf_analytics.guard_generation_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_analytics, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sf_analytics.projection_state s
     WHERE s.tenant_id = OLD.tenant_id AND s.definition_id = OLD.definition_id
       AND s.active_generation = OLD.generation
  ) THEN
    RAISE EXCEPTION 'active projection generation is retained' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
ALTER FUNCTION sf_analytics.guard_generation_delete() OWNER TO sf_migrator;

CREATE TRIGGER projection_applied_event_delete_guard
  BEFORE DELETE ON sf_analytics.projection_applied_event
  FOR EACH ROW EXECUTE FUNCTION sf_analytics.guard_generation_delete();

CREATE FUNCTION sf_analytics.guard_metric_point()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_analytics, pg_temp
AS $$
DECLARE
  d record;
  k text;
  v jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM sf_analytics.projection_state s
       WHERE s.tenant_id = OLD.tenant_id AND s.definition_id = OLD.definition_id
         AND s.active_generation = OLD.generation
    ) THEN
      RAISE EXCEPTION 'active projection generation is retained' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT metric_code, purpose_code INTO d
      FROM sf_analytics.metric_definition
     WHERE tenant_id = NEW.tenant_id AND definition_id = NEW.definition_id;
    IF NOT FOUND OR d.metric_code <> NEW.metric_code OR d.purpose_code <> NEW.purpose_code THEN
      RAISE EXCEPTION 'metric point must carry its definition metric code and purpose'
        USING ERRCODE = '23514';
    END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(NEW.dimensions)) > 8 THEN
      RAISE EXCEPTION 'metric point has too many dimensions' USING ERRCODE = '23514';
    END IF;
    FOR k, v IN SELECT key, value FROM jsonb_each(NEW.dimensions) LOOP
      IF k !~ '^[a-z][a-z0-9_]{1,63}$' THEN
        RAISE EXCEPTION 'metric point dimension key is not a category name' USING ERRCODE = '23514';
      END IF;
      IF jsonb_typeof(v) = 'boolean' THEN
        CONTINUE;
      END IF;
      IF jsonb_typeof(v) <> 'string' OR NOT sf_analytics.is_category_code(v #>> '{}') THEN
        RAISE EXCEPTION 'metric point dimension value is not a category code (raw values are refused)'
          USING ERRCODE = '23514';
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.definition_id IS DISTINCT FROM OLD.definition_id
     OR NEW.generation IS DISTINCT FROM OLD.generation
     OR NEW.period_start IS DISTINCT FROM OLD.period_start
     OR NEW.period_end IS DISTINCT FROM OLD.period_end
     OR NEW.dimension_hash IS DISTINCT FROM OLD.dimension_hash
     OR NEW.dimensions IS DISTINCT FROM OLD.dimensions
     OR NEW.metric_id IS DISTINCT FROM OLD.metric_id
     OR NEW.metric_code IS DISTINCT FROM OLD.metric_code
     OR NEW.purpose_code IS DISTINCT FROM OLD.purpose_code THEN
    RAISE EXCEPTION 'metric point identity, dimensions and purpose are immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.contributor_count < OLD.contributor_count THEN
    RAISE EXCEPTION 'metric point contributor count is monotonic' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_analytics.guard_metric_point() OWNER TO sf_migrator;

CREATE TRIGGER metric_point_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_analytics.metric_point
  FOR EACH ROW EXECUTE FUNCTION sf_analytics.guard_metric_point();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_analytics FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_analytics FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_analytics FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE (status, retired_at) ON sf_analytics.metric_definition TO sf_cmp045_rw;
GRANT SELECT, INSERT,
  UPDATE (active_generation, building_generation, build_token, build_lease_expires_at,
    last_rebuilt_at, updated_at)
  ON sf_analytics.projection_state TO sf_cmp045_rw;
GRANT SELECT, INSERT, DELETE,
  UPDATE (value, contributor_count, last_event_at, updated_at)
  ON sf_analytics.metric_point TO sf_cmp045_rw;
GRANT SELECT, INSERT, DELETE ON sf_analytics.projection_applied_event TO sf_cmp045_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_analytics.idempotency_record TO sf_cmp045_rw;

GRANT EXECUTE ON FUNCTION sf_analytics.is_category_code(text) TO sf_cmp045_rw;
GRANT EXECUTE ON FUNCTION sf_analytics.is_identifying_field_name(text) TO sf_cmp045_rw;
GRANT EXECUTE ON FUNCTION sf_analytics.guard_definition() TO sf_cmp045_rw;
GRANT EXECUTE ON FUNCTION sf_analytics.guard_projection_state() TO sf_cmp045_rw;
GRANT EXECUTE ON FUNCTION sf_analytics.guard_generation_delete() TO sf_cmp045_rw;
GRANT EXECUTE ON FUNCTION sf_analytics.guard_metric_point() TO sf_cmp045_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_analytics FROM sf_cmp045_rw;
REVOKE ALL ON SCHEMA sf_analytics FROM sf_app;
DROP SCHEMA IF EXISTS sf_analytics CASCADE;
-- Role sf_cmp045_rw retained (may be referenced by runtime logins); never DROP ROLE here.
