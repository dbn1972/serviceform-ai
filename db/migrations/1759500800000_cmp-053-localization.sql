-- ServiceForm AI CMP-053 Localization Service schema (ADR-0006 Option A).
-- Schema sf_localization owned by sf_migrator. DML via sf_cmp053_rw. RLS policies TO sf_app.
-- Translation catalogs, locale fallback, and format profiles. No named-service branching.
-- Published catalog versions are immutable. No statutory eligibility/approval/rejection.

-- Up Migration

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_migrator') THEN
    CREATE ROLE sf_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_migrator IS 'Deployment/migration role. Owns authoritative schemas/tables. Never a runtime login.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp053_rw') THEN
    CREATE ROLE sf_cmp053_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp053_rw IS 'CMP-053 privilege role (ADR-0006). NOLOGIN. Holds DML on sf_localization business tables.';

CREATE SCHEMA sf_localization AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_localization IS 'isolation_class=TENANT_SCOPED; owner=CMP-053; Locale catalogs fallback and format profiles';

REVOKE ALL ON SCHEMA sf_localization FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_localization TO sf_cmp053_rw;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_localization REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_localization REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_localization REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- sf:isolation sf_localization.locale TENANT_SCOPED owner=CMP-053
CREATE TABLE sf_localization.locale (
  tenant_id uuid NOT NULL,
  locale_id uuid NOT NULL,
  locale_tag text NOT NULL CHECK (locale_tag ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,4}$'),
  fallback_tag text CHECK (fallback_tag IS NULL OR fallback_tag ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,4}$'),
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  PRIMARY KEY (tenant_id, locale_id),
  UNIQUE (tenant_id, locale_tag),
  CHECK (fallback_tag IS NULL OR fallback_tag <> locale_tag)
);
CREATE UNIQUE INDEX locale_default_idx
  ON sf_localization.locale (tenant_id) WHERE is_default;
ALTER TABLE sf_localization.locale ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_localization.locale FORCE ROW LEVEL SECURITY;
CREATE POLICY locale_isolation ON sf_localization.locale TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_localization.locale OWNER TO sf_migrator;

-- sf:isolation sf_localization.format_profile TENANT_SCOPED owner=CMP-053
CREATE TABLE sf_localization.format_profile (
  tenant_id uuid NOT NULL,
  locale_id uuid NOT NULL,
  date_skeleton text NOT NULL CHECK (char_length(date_skeleton) BETWEEN 1 AND 32),
  time_skeleton text NOT NULL CHECK (char_length(time_skeleton) BETWEEN 1 AND 32),
  decimal_separator text NOT NULL CHECK (char_length(decimal_separator) = 1),
  group_separator text NOT NULL CHECK (char_length(group_separator) BETWEEN 1 AND 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, locale_id),
  FOREIGN KEY (tenant_id, locale_id)
    REFERENCES sf_localization.locale (tenant_id, locale_id)
);
ALTER TABLE sf_localization.format_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_localization.format_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY format_profile_isolation ON sf_localization.format_profile TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_localization.format_profile OWNER TO sf_migrator;

-- sf:isolation sf_localization.catalog TENANT_SCOPED owner=CMP-053
CREATE TABLE sf_localization.catalog (
  tenant_id uuid NOT NULL,
  catalog_id uuid NOT NULL,
  catalog_code text NOT NULL CHECK (catalog_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  PRIMARY KEY (tenant_id, catalog_id),
  UNIQUE (tenant_id, catalog_code)
);
ALTER TABLE sf_localization.catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_localization.catalog FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_isolation ON sf_localization.catalog TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_localization.catalog OWNER TO sf_migrator;

-- sf:isolation sf_localization.catalog_version TENANT_SCOPED owner=CMP-053
CREATE TABLE sf_localization.catalog_version (
  tenant_id uuid NOT NULL,
  catalog_id uuid NOT NULL,
  version_no bigint NOT NULL CHECK (version_no >= 1),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^sha256:[0-9a-f]{64}$'),
  published_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, catalog_id, version_no),
  FOREIGN KEY (tenant_id, catalog_id)
    REFERENCES sf_localization.catalog (tenant_id, catalog_id),
  CHECK (
    (status = 'DRAFT' AND published_at IS NULL AND content_hash IS NULL)
    OR (status IN ('PUBLISHED', 'RETIRED') AND published_at IS NOT NULL AND content_hash IS NOT NULL)
  )
);
CREATE INDEX catalog_version_status_idx
  ON sf_localization.catalog_version (tenant_id, catalog_id, status, version_no DESC);
ALTER TABLE sf_localization.catalog_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_localization.catalog_version FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_version_isolation ON sf_localization.catalog_version TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_localization.catalog_version OWNER TO sf_migrator;

-- sf:isolation sf_localization.message TENANT_SCOPED owner=CMP-053
CREATE TABLE sf_localization.message (
  tenant_id uuid NOT NULL,
  catalog_id uuid NOT NULL,
  version_no bigint NOT NULL,
  locale_id uuid NOT NULL,
  message_key text NOT NULL CHECK (message_key ~ '^[a-z][a-z0-9._-]{0,198}$'),
  message_text text NOT NULL CHECK (char_length(message_text) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, catalog_id, version_no, locale_id, message_key),
  FOREIGN KEY (tenant_id, catalog_id, version_no)
    REFERENCES sf_localization.catalog_version (tenant_id, catalog_id, version_no),
  FOREIGN KEY (tenant_id, locale_id)
    REFERENCES sf_localization.locale (tenant_id, locale_id)
);
CREATE INDEX message_lookup_idx
  ON sf_localization.message (tenant_id, catalog_id, version_no, locale_id, message_key);
ALTER TABLE sf_localization.message ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_localization.message FORCE ROW LEVEL SECURITY;
CREATE POLICY message_isolation ON sf_localization.message TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_localization.message OWNER TO sf_migrator;

-- sf:isolation sf_localization.idempotency_record TENANT_SCOPED owner=CMP-053
CREATE TABLE sf_localization.idempotency_record (
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
ALTER TABLE sf_localization.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_localization.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_localization.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_localization.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_localization.enforce_catalog_version_machine()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_localization, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'catalog version insert must be DRAFT' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR OLD.catalog_id IS DISTINCT FROM NEW.catalog_id
       OR OLD.version_no IS DISTINCT FROM NEW.version_no
       OR OLD.created_by IS DISTINCT FROM NEW.created_by THEN
      RAISE EXCEPTION 'catalog version identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'RETIRED' THEN
      RAISE EXCEPTION 'retired catalog versions are immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'PUBLISHED' THEN
      IF NEW.status IS DISTINCT FROM 'RETIRED'
         OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
         OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
        RAISE EXCEPTION 'published catalog versions are immutable' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT', 'PUBLISHED') THEN
      RAISE EXCEPTION 'draft catalog version may only publish' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'catalog version delete is not permitted' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER catalog_version_machine
  BEFORE INSERT OR UPDATE OR DELETE ON sf_localization.catalog_version
  FOR EACH ROW
  EXECUTE FUNCTION sf_localization.enforce_catalog_version_machine();
ALTER FUNCTION sf_localization.enforce_catalog_version_machine() OWNER TO sf_migrator;

CREATE FUNCTION sf_localization.enforce_published_message_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_localization, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
    FROM sf_localization.catalog_version
   WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
     AND catalog_id = COALESCE(NEW.catalog_id, OLD.catalog_id)
     AND version_no = COALESCE(NEW.version_no, OLD.version_no);
  IF v_status IN ('PUBLISHED', 'RETIRED') THEN
    RAISE EXCEPTION 'published catalog versions are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER message_published_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_localization.message
  FOR EACH ROW
  EXECUTE FUNCTION sf_localization.enforce_published_message_immutability();
ALTER FUNCTION sf_localization.enforce_published_message_immutability() OWNER TO sf_migrator;

REVOKE ALL ON ALL TABLES IN SCHEMA sf_localization FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_localization FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_localization FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE (fallback_tag, is_default, status) ON sf_localization.locale TO sf_cmp053_rw;
GRANT SELECT, INSERT, UPDATE (date_skeleton, time_skeleton, decimal_separator, group_separator, updated_at)
  ON sf_localization.format_profile TO sf_cmp053_rw;
GRANT SELECT, INSERT ON sf_localization.catalog TO sf_cmp053_rw;
GRANT SELECT, INSERT, UPDATE (status, content_hash, published_at) ON sf_localization.catalog_version TO sf_cmp053_rw;
GRANT SELECT, INSERT, UPDATE (message_text, updated_at), DELETE ON sf_localization.message TO sf_cmp053_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_localization.idempotency_record TO sf_cmp053_rw;
GRANT EXECUTE ON FUNCTION sf_localization.enforce_catalog_version_machine() TO sf_cmp053_rw;
GRANT EXECUTE ON FUNCTION sf_localization.enforce_published_message_immutability() TO sf_cmp053_rw;

ALTER TABLE sf_localization.locale ALTER COLUMN locale_tag SET STATISTICS 0;
ALTER TABLE sf_localization.message ALTER COLUMN message_text SET STATISTICS 0;
ALTER TABLE sf_localization.message ALTER COLUMN message_key SET STATISTICS 0;

-- Down Migration
REVOKE ALL ON SCHEMA sf_localization FROM sf_cmp053_rw;
DROP SCHEMA IF EXISTS sf_localization CASCADE;
DROP ROLE IF EXISTS sf_cmp053_rw;
