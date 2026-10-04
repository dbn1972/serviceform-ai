-- CMP-048 Security Platform (SF-M01-002). ADR-0006 Option A: DML via sf_cmp048_rw.
-- Isolation declarations precede every CREATE TABLE (Constitution #24).
-- Roles: PostgreSQL has no CREATE ROLE IF NOT EXISTS. Create once via pg_roles guard.
-- NOBYPASSRLS is the PostgreSQL default we state explicitly (lint allows the NO* form;
-- a bare BYPASSRLS grant remains forbidden).

-- Up Migration

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_migrator') THEN
    CREATE ROLE sf_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp048_rw') THEN
    CREATE ROLE sf_cmp048_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

COMMENT ON ROLE sf_cmp048_rw IS 'CMP-048 NOLOGIN privilege role. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA IF NOT EXISTS sf_security;
COMMENT ON SCHEMA sf_security IS 'isolation_class=PLATFORM_OPERATIONAL; owner=CMP-048; security platform authoritative state';

REVOKE ALL ON SCHEMA sf_security FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_security TO sf_app;
GRANT USAGE ON SCHEMA sf_security TO sf_cmp048_rw;

-- sf:isolation sf_security.privileged_access_record TENANT_SCOPED owner=CMP-048
CREATE TABLE sf_security.privileged_access_record (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  grantee_user_id uuid NOT NULL,
  grantee_actor_type text NOT NULL CHECK (grantee_actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  access_kind text NOT NULL CHECK (access_kind IN ('SUPPORT_CASE', 'BREAK_GLASS')),
  purpose_code text NOT NULL CHECK (purpose_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  justification text NOT NULL CHECK (char_length(justification) BETWEEN 1 AND 1000),
  support_ticket_ref text,
  scope_actions text[] NOT NULL CHECK (cardinality(scope_actions) >= 1),
  scope_resource_types text[] NOT NULL CHECK (cardinality(scope_resource_types) >= 1),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  status text NOT NULL CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED')),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_by uuid,
  revoked_at timestamptz,
  post_review_by uuid,
  post_review_at timestamptz,
  post_review_outcome text,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > starts_at),
  CHECK (approved_by IS NULL OR approved_by <> grantee_user_id),
  CHECK (
    (status = 'REQUESTED' AND approved_by IS NULL AND approved_at IS NULL AND revoked_by IS NULL AND revoked_at IS NULL)
    OR (status = 'APPROVED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR (status IN ('REJECTED', 'REVOKED', 'EXPIRED'))
  )
);
ALTER TABLE sf_security.privileged_access_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_security.privileged_access_record FORCE ROW LEVEL SECURITY;
CREATE POLICY privileged_access_tenant ON sf_security.privileged_access_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());

-- sf:isolation sf_security.security_policy_metadata PLATFORM_OPERATIONAL owner=CMP-048
CREATE TABLE sf_security.security_policy_metadata (
  id uuid PRIMARY KEY,
  bundle_name text NOT NULL CHECK (bundle_name ~ '^[a-z][a-z0-9._-]{1,63}$'),
  revision text NOT NULL CHECK (char_length(revision) BETWEEN 1 AND 128),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  roots text[] NOT NULL,
  status text NOT NULL CHECK (status IN ('VALIDATED', 'ACTIVE', 'FAILED', 'SUPERSEDED')),
  published_by uuid NOT NULL,
  approved_by uuid,
  test_report_sha256 text CHECK (test_report_sha256 IS NULL OR test_report_sha256 ~ '^[0-9a-f]{64}$'),
  signing_key_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  failure_code text,
  UNIQUE (bundle_name, revision),
  CHECK (approved_by IS NULL OR approved_by <> published_by)
);
CREATE UNIQUE INDEX security_policy_one_active ON sf_security.security_policy_metadata (bundle_name) WHERE status = 'ACTIVE';

-- sf:isolation sf_security.idempotency_record TENANT_SCOPED owner=CMP-048
CREATE TABLE sf_security.idempotency_record (
  tenant_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  endpoint text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
  response_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, principal_id, endpoint, idempotency_key)
);
ALTER TABLE sf_security.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_security.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_tenant ON sf_security.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());

-- sf:isolation sf_security.idempotency_record_platform PLATFORM_OPERATIONAL owner=CMP-048
CREATE TABLE sf_security.idempotency_record_platform (
  principal_id uuid NOT NULL,
  endpoint text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
  response_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (principal_id, endpoint, idempotency_key)
);

CREATE FUNCTION sf_security.privileged_access_guard() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'REQUESTED' THEN
      RAISE EXCEPTION 'privileged_access insert must be REQUESTED' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.requested_by IS DISTINCT FROM sf_platform.current_actor_id() THEN
      RAISE EXCEPTION 'requested_by must equal current actor' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'insert cannot include approval' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.grantee_user_id IS DISTINCT FROM NEW.grantee_user_id
     OR OLD.grantee_actor_type IS DISTINCT FROM NEW.grantee_actor_type
     OR OLD.access_kind IS DISTINCT FROM NEW.access_kind
     OR OLD.purpose_code IS DISTINCT FROM NEW.purpose_code
     OR OLD.justification IS DISTINCT FROM NEW.justification
     OR OLD.support_ticket_ref IS DISTINCT FROM NEW.support_ticket_ref
     OR OLD.scope_actions IS DISTINCT FROM NEW.scope_actions
     OR OLD.scope_resource_types IS DISTINCT FROM NEW.scope_resource_types
     OR OLD.requested_by IS DISTINCT FROM NEW.requested_by
     OR OLD.starts_at IS DISTINCT FROM NEW.starts_at
     OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
  THEN
    RAISE EXCEPTION 'privileged_access immutable columns' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'REQUESTED' AND NEW.status = 'APPROVED' THEN
    IF NEW.approved_by IS DISTINCT FROM sf_platform.current_actor_id() THEN
      RAISE EXCEPTION 'approved_by must equal current actor' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.approved_by IS NOT DISTINCT FROM NEW.requested_by
       OR NEW.approved_by IS NOT DISTINCT FROM NEW.grantee_user_id THEN
      RAISE EXCEPTION 'self-approval refused' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'REQUESTED' AND NEW.status IN ('REJECTED', 'REVOKED') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'APPROVED' AND NEW.status IN ('REVOKED', 'EXPIRED') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'illegal privileged_access transition' USING ERRCODE = 'check_violation';
END
$$;

CREATE TRIGGER privileged_access_guard
  BEFORE INSERT OR UPDATE ON sf_security.privileged_access_record
  FOR EACH ROW EXECUTE FUNCTION sf_security.privileged_access_guard();

CREATE FUNCTION sf_security.security_policy_guard() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'VALIDATED' THEN
      RAISE EXCEPTION 'policy insert must be VALIDATED' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.bundle_name IS DISTINCT FROM NEW.bundle_name
     OR OLD.revision IS DISTINCT FROM NEW.revision
     OR OLD.content_sha256 IS DISTINCT FROM NEW.content_sha256
     OR OLD.roots IS DISTINCT FROM NEW.roots
     OR OLD.published_by IS DISTINCT FROM NEW.published_by
     OR OLD.test_report_sha256 IS DISTINCT FROM NEW.test_report_sha256
     OR OLD.signing_key_ref IS DISTINCT FROM NEW.signing_key_ref
  THEN
    RAISE EXCEPTION 'policy content immutable' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'VALIDATED' AND NEW.status = 'ACTIVE' THEN
    IF NEW.approved_by IS NULL OR NEW.approved_by IS NOT DISTINCT FROM NEW.published_by THEN
      RAISE EXCEPTION 'maker-checker required' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.test_report_sha256 IS NULL THEN
      RAISE EXCEPTION 'test report required to activate' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'VALIDATED' AND NEW.status = 'FAILED' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'illegal policy status transition' USING ERRCODE = 'check_violation';
END
$$;

CREATE TRIGGER security_policy_guard
  BEFORE INSERT OR UPDATE ON sf_security.security_policy_metadata
  FOR EACH ROW EXECUTE FUNCTION sf_security.security_policy_guard();

REVOKE ALL ON FUNCTION sf_security.privileged_access_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION sf_security.security_policy_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_security.privileged_access_guard() TO sf_cmp048_rw;
GRANT EXECUTE ON FUNCTION sf_security.security_policy_guard() TO sf_cmp048_rw;

GRANT SELECT, INSERT ON sf_security.privileged_access_record TO sf_cmp048_rw;
GRANT UPDATE (status, approved_by, approved_at, revoked_by, revoked_at, post_review_by, post_review_at, post_review_outcome, version)
  ON sf_security.privileged_access_record TO sf_cmp048_rw;

GRANT SELECT, INSERT ON sf_security.security_policy_metadata TO sf_cmp048_rw;
GRANT UPDATE (status, activated_at, failure_code, approved_by)
  ON sf_security.security_policy_metadata TO sf_cmp048_rw;

GRANT SELECT, INSERT ON sf_security.idempotency_record TO sf_cmp048_rw;
GRANT UPDATE (status, response_ref) ON sf_security.idempotency_record TO sf_cmp048_rw;
GRANT SELECT, INSERT ON sf_security.idempotency_record_platform TO sf_cmp048_rw;
GRANT UPDATE (status, response_ref) ON sf_security.idempotency_record_platform TO sf_cmp048_rw;

-- SF-CON-OUTBOX v1 copied verbatim after placeholder substitution. Do not change grants.
-- sf:isolation sf_security.outbox_event TENANT_SCOPED owner=CMP-048
CREATE TABLE sf_security.outbox_event (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  tenant_id uuid NOT NULL,
  topic text NOT NULL CHECK (topic ~ '^[a-zA-Z0-9._-]{3,249}$'),
  partition_key text NOT NULL CHECK (length(partition_key) BETWEEN 1 AND 200),
  event_type text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version >= 1),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 0),
  envelope jsonb NOT NULL CHECK (octet_length(envelope::text) <= 262144),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'DEAD_LETTERED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text CHECK (last_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CHECK (envelope ->> 'event_id' = event_id::text),
  CHECK (envelope ->> 'tenant_id' = tenant_id::text),
  CHECK (envelope ->> 'aggregate_id' = aggregate_id::text),
  CHECK (envelope ->> 'event_type' = event_type)
);
CREATE INDEX outbox_event_claim_idx ON sf_security.outbox_event (partition_key, seq) WHERE status <> 'PUBLISHED';
CREATE INDEX outbox_event_due_idx ON sf_security.outbox_event (next_attempt_at) WHERE status = 'PENDING';
ALTER TABLE sf_security.outbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_security.outbox_event FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_event_tenant_insert ON sf_security.outbox_event FOR INSERT TO sf_app
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
CREATE POLICY outbox_event_publisher ON sf_security.outbox_event TO sf_outbox_publisher
  USING (true) WITH CHECK (true);
GRANT INSERT ON sf_security.outbox_event TO sf_app;

-- sf:isolation sf_security.outbox_event_platform PLATFORM_OPERATIONAL owner=CMP-048
CREATE TABLE sf_security.outbox_event_platform (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  topic text NOT NULL CHECK (topic ~ '^[a-zA-Z0-9._-]{3,249}$'),
  partition_key text NOT NULL CHECK (length(partition_key) BETWEEN 1 AND 200),
  event_type text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version >= 1),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 0),
  envelope jsonb NOT NULL CHECK (octet_length(envelope::text) <= 262144),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'DEAD_LETTERED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text CHECK (last_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CHECK (envelope ->> 'event_id' = event_id::text),
  CHECK (jsonb_typeof(envelope -> 'tenant_id') = 'null'),
  CHECK (envelope ->> 'aggregate_id' = aggregate_id::text),
  CHECK (envelope ->> 'event_type' = event_type)
);
CREATE INDEX outbox_event_platform_claim_idx ON sf_security.outbox_event_platform (partition_key, seq) WHERE status <> 'PUBLISHED';
CREATE INDEX outbox_event_platform_due_idx ON sf_security.outbox_event_platform (next_attempt_at) WHERE status = 'PENDING';
GRANT INSERT ON sf_security.outbox_event_platform TO sf_app;

GRANT USAGE ON SCHEMA sf_security TO sf_outbox_publisher;
GRANT SELECT, DELETE ON sf_security.outbox_event, sf_security.outbox_event_platform TO sf_outbox_publisher;
GRANT UPDATE (status, attempts, next_attempt_at, lease_owner, lease_expires_at, last_error_code, published_at)
  ON sf_security.outbox_event, sf_security.outbox_event_platform TO sf_outbox_publisher;

-- sf:isolation sf_security.inbox_event TENANT_SCOPED owner=CMP-048
CREATE TABLE sf_security.inbox_event (
  consumer_group text NOT NULL CHECK (consumer_group ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  event_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_group, event_id)
);
ALTER TABLE sf_security.inbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_security.inbox_event FORCE ROW LEVEL SECURITY;
CREATE POLICY inbox_event_tenant ON sf_security.inbox_event TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
GRANT SELECT, INSERT ON sf_security.inbox_event TO sf_app;

-- sf:isolation sf_security.inbox_event_platform PLATFORM_OPERATIONAL owner=CMP-048
CREATE TABLE sf_security.inbox_event_platform (
  consumer_group text NOT NULL CHECK (consumer_group ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  event_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_group, event_id)
);
GRANT SELECT, INSERT ON sf_security.inbox_event_platform TO sf_app;

ALTER SCHEMA sf_security OWNER TO sf_migrator;
ALTER TABLE sf_security.privileged_access_record OWNER TO sf_migrator;
ALTER TABLE sf_security.security_policy_metadata OWNER TO sf_migrator;
ALTER TABLE sf_security.idempotency_record OWNER TO sf_migrator;
ALTER TABLE sf_security.idempotency_record_platform OWNER TO sf_migrator;
ALTER TABLE sf_security.outbox_event OWNER TO sf_migrator;
ALTER TABLE sf_security.outbox_event_platform OWNER TO sf_migrator;
ALTER TABLE sf_security.inbox_event OWNER TO sf_migrator;
ALTER TABLE sf_security.inbox_event_platform OWNER TO sf_migrator;
ALTER FUNCTION sf_security.privileged_access_guard() OWNER TO sf_migrator;
ALTER FUNCTION sf_security.security_policy_guard() OWNER TO sf_migrator;

REVOKE ALL ON ALL TABLES IN SCHEMA sf_security FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_security FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_security FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_security REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_security REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_security REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_security REVOKE ALL ON TABLES FROM sf_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_security REVOKE ALL ON SEQUENCES FROM sf_app;

-- Down Migration
DROP SCHEMA IF EXISTS sf_security CASCADE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp048_rw')
     AND NOT EXISTS (
       SELECT 1 FROM pg_auth_members m
       JOIN pg_roles r ON r.oid = m.roleid
       WHERE r.rolname = 'sf_cmp048_rw'
     )
  THEN
    DROP ROLE sf_cmp048_rw;
  END IF;
END
$$;
