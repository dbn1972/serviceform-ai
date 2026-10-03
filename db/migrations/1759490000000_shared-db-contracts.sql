-- ServiceForm AI shared database contracts (SF-CON-DB-SESSION-CONTEXT, SF-CON-OUTBOX).
-- Creates no business tables. Provides the tenant-context accessor every RLS policy uses and
-- the group role under which outbox publishers run. Contract text:
-- contracts/shared/schemas/db-session-context.schema.json, contracts/shared/sql/outbox.template.sql.

-- Up Migration

-- After a SET LOCAL transaction ends, a reused pooled session holds '' for app.tenant_id, and
-- current_setting('app.tenant_id', true)::uuid raises "invalid input syntax for type uuid".
-- NULLIF maps both "never set" and "reset to ''" to NULL, so policies return no rows instead.
CREATE FUNCTION sf_platform.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
COMMENT ON FUNCTION sf_platform.current_tenant_id() IS
  'SF-CON-DB-SESSION-CONTEXT: tenant of the current transaction, NULL when not set. The only form RLS policies may use.';

CREATE FUNCTION sf_platform.current_actor_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.actor_id', true), '')::uuid $$;

CREATE FUNCTION sf_platform.current_correlation_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.correlation_id', true), '')::uuid $$;

REVOKE ALL ON FUNCTION sf_platform.current_tenant_id(), sf_platform.current_actor_id(),
  sf_platform.current_correlation_id() FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_outbox_publisher') THEN
    CREATE ROLE sf_outbox_publisher NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_outbox_publisher IS
  'SF-CON-OUTBOX: group role for outbox publisher login roles. Reads and marks outbox tables only. Must never hold BYPASSRLS or be granted sf_app.';

GRANT USAGE ON SCHEMA sf_platform TO sf_outbox_publisher;
GRANT EXECUTE ON FUNCTION sf_platform.current_tenant_id(), sf_platform.current_actor_id(),
  sf_platform.current_correlation_id() TO sf_app, sf_outbox_publisher;

-- Down Migration
REVOKE EXECUTE ON FUNCTION sf_platform.current_tenant_id(), sf_platform.current_actor_id(),
  sf_platform.current_correlation_id() FROM sf_app, sf_outbox_publisher;
REVOKE USAGE ON SCHEMA sf_platform FROM sf_outbox_publisher;
DROP ROLE IF EXISTS sf_outbox_publisher;
DROP FUNCTION IF EXISTS sf_platform.current_correlation_id();
DROP FUNCTION IF EXISTS sf_platform.current_actor_id();
DROP FUNCTION IF EXISTS sf_platform.current_tenant_id();
