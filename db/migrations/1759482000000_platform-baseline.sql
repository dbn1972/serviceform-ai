-- ServiceForm AI M00 platform baseline.
-- Creates no business tables. Establishes the platform schema that holds migration
-- bookkeeping, the application group role used by every runtime login role, and safe
-- defaults on the public schema (TI v1.0 s8.1: application roles never have BYPASSRLS).
--
-- sf:schema sf_platform PLATFORM_OPERATIONAL owner=CMP-055

-- Up Migration
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS sf_platform;
COMMENT ON SCHEMA sf_platform IS 'isolation_class=PLATFORM_OPERATIONAL; owner=CMP-055; platform bookkeeping only';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_app') THEN
    CREATE ROLE sf_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_app IS 'Group role for application runtime login roles. Must never hold BYPASSRLS.';

-- PostgreSQL 15+ already withholds this; kept for clusters upgraded from older versions.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_platform TO sf_app;

-- Down Migration
REVOKE USAGE ON SCHEMA sf_platform FROM sf_app;
-- CREATE on public is not re-granted: PostgreSQL 15+ withholds it by default.
DROP ROLE IF EXISTS sf_app;
