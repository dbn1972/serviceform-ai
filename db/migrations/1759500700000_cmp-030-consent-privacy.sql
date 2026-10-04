-- ServiceForm AI CMP-030 Consent & Privacy schema (ADR-0006 Option A).
-- Schema sf_consent_privacy owned by sf_migrator. DML via sf_cmp030_rw. RLS policies TO sf_app.
-- Platform consent/purpose/notice/access-check machinery only. No statutory DPDP content.

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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp030_rw') THEN
    CREATE ROLE sf_cmp030_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp030_rw IS 'CMP-030 privilege role (ADR-0006). NOLOGIN. Holds DML on sf_consent_privacy business tables.';

CREATE SCHEMA sf_consent_privacy AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_consent_privacy IS 'isolation_class=mixed; owner=CMP-030; Consent purpose notice and access-check';

REVOKE ALL ON SCHEMA sf_consent_privacy FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_consent_privacy TO sf_cmp030_rw;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_consent_privacy REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_consent_privacy REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_consent_privacy REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- sf:isolation sf_consent_privacy.purpose TENANT_SCOPED owner=CMP-030
CREATE TABLE sf_consent_privacy.purpose (
  tenant_id uuid NOT NULL,
  purpose_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  requires_consent boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, purpose_id),
  UNIQUE (tenant_id, code)
);
ALTER TABLE sf_consent_privacy.purpose ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_consent_privacy.purpose FORCE ROW LEVEL SECURITY;
CREATE POLICY purpose_isolation ON sf_consent_privacy.purpose TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_consent_privacy.purpose OWNER TO sf_migrator;

-- sf:isolation sf_consent_privacy.privacy_notice TENANT_SCOPED owner=CMP-030
CREATE TABLE sf_consent_privacy.privacy_notice (
  tenant_id uuid NOT NULL,
  notice_id uuid NOT NULL,
  purpose_id uuid NOT NULL,
  version_no bigint NOT NULL CHECK (version_no >= 1),
  content_ref text NOT NULL CHECK (char_length(content_ref) BETWEEN 1 AND 500),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  PRIMARY KEY (tenant_id, notice_id),
  UNIQUE (tenant_id, purpose_id, version_no),
  FOREIGN KEY (tenant_id, purpose_id) REFERENCES sf_consent_privacy.purpose (tenant_id, purpose_id),
  CHECK (
    (status = 'DRAFT' AND published_at IS NULL)
    OR (status IN ('PUBLISHED', 'SUPERSEDED') AND published_at IS NOT NULL)
  )
);
CREATE INDEX privacy_notice_purpose_idx
  ON sf_consent_privacy.privacy_notice (tenant_id, purpose_id, version_no DESC);
ALTER TABLE sf_consent_privacy.privacy_notice ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_consent_privacy.privacy_notice FORCE ROW LEVEL SECURITY;
CREATE POLICY privacy_notice_isolation ON sf_consent_privacy.privacy_notice TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_consent_privacy.privacy_notice OWNER TO sf_migrator;

-- sf:isolation sf_consent_privacy.consent TENANT_SCOPED owner=CMP-030
CREATE TABLE sf_consent_privacy.consent (
  tenant_id uuid NOT NULL,
  consent_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  purpose_id uuid NOT NULL,
  notice_id uuid,
  status text NOT NULL CHECK (status IN ('GRANTED', 'WITHDRAWN')),
  granted_at timestamptz NOT NULL,
  withdrawn_at timestamptz,
  applied_by uuid NOT NULL,
  applied_for uuid NOT NULL,
  representation_basis text NOT NULL CHECK (representation_basis IN ('SELF', 'ASSISTED', 'LEGAL_REP')),
  channel text NOT NULL CHECK (channel IN ('WEB', 'COUNTER', 'API')),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, consent_id),
  FOREIGN KEY (tenant_id, purpose_id) REFERENCES sf_consent_privacy.purpose (tenant_id, purpose_id),
  FOREIGN KEY (tenant_id, notice_id) REFERENCES sf_consent_privacy.privacy_notice (tenant_id, notice_id),
  CHECK (
    (status = 'GRANTED' AND withdrawn_at IS NULL)
    OR (status = 'WITHDRAWN' AND withdrawn_at IS NOT NULL)
  ),
  CHECK (applied_for = subject_id)
);
CREATE UNIQUE INDEX consent_active_subject_purpose_uidx
  ON sf_consent_privacy.consent (tenant_id, subject_id, purpose_id)
  WHERE status = 'GRANTED';
CREATE INDEX consent_subject_idx ON sf_consent_privacy.consent (tenant_id, subject_id, granted_at DESC);
ALTER TABLE sf_consent_privacy.consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_consent_privacy.consent FORCE ROW LEVEL SECURITY;
CREATE POLICY consent_isolation ON sf_consent_privacy.consent TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_consent_privacy.consent OWNER TO sf_migrator;

-- sf:isolation sf_consent_privacy.consent_event TENANT_SCOPED owner=CMP-030
CREATE TABLE sf_consent_privacy.consent_event (
  tenant_id uuid NOT NULL,
  event_id uuid NOT NULL,
  consent_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('GRANTED', 'WITHDRAWN')),
  occurred_at timestamptz NOT NULL,
  actor_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  notice_id uuid,
  PRIMARY KEY (tenant_id, event_id),
  FOREIGN KEY (tenant_id, consent_id) REFERENCES sf_consent_privacy.consent (tenant_id, consent_id)
);
CREATE INDEX consent_event_consent_idx
  ON sf_consent_privacy.consent_event (tenant_id, consent_id, occurred_at);
ALTER TABLE sf_consent_privacy.consent_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_consent_privacy.consent_event FORCE ROW LEVEL SECURITY;
CREATE POLICY consent_event_isolation ON sf_consent_privacy.consent_event TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_consent_privacy.consent_event OWNER TO sf_migrator;

-- sf:isolation sf_consent_privacy.idempotency_record TENANT_SCOPED owner=CMP-030
CREATE TABLE sf_consent_privacy.idempotency_record (
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
ALTER TABLE sf_consent_privacy.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_consent_privacy.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_consent_privacy.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_consent_privacy.idempotency_record OWNER TO sf_migrator;

-- sf:isolation sf_consent_privacy.idempotency_record_platform PLATFORM_OPERATIONAL owner=CMP-030
CREATE TABLE sf_consent_privacy.idempotency_record_platform (
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
  PRIMARY KEY (principal_id, endpoint, idempotency_key)
);
ALTER TABLE sf_consent_privacy.idempotency_record_platform ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_consent_privacy.idempotency_record_platform FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_platform_actor ON sf_consent_privacy.idempotency_record_platform TO sf_app
  USING (principal_id = sf_platform.current_actor_id())
  WITH CHECK (principal_id = sf_platform.current_actor_id());
ALTER TABLE sf_consent_privacy.idempotency_record_platform OWNER TO sf_migrator;

CREATE FUNCTION sf_consent_privacy.enforce_notice_publish_machine()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_consent_privacy, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'privacy notice insert must be DRAFT'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'SUPERSEDED' THEN
      RAISE EXCEPTION 'superseded privacy notice cannot be mutated'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.status = 'PUBLISHED' AND NEW.status IS DISTINCT FROM 'SUPERSEDED' THEN
      RAISE EXCEPTION 'published privacy notice may only move to SUPERSEDED'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT', 'PUBLISHED') THEN
      RAISE EXCEPTION 'draft privacy notice may only publish'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.notice_id IS DISTINCT FROM OLD.notice_id
       OR NEW.purpose_id IS DISTINCT FROM OLD.purpose_id
       OR NEW.version_no IS DISTINCT FROM OLD.version_no
       OR NEW.content_ref IS DISTINCT FROM OLD.content_ref
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'privacy notice identity fields are immutable'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'privacy notice delete is not permitted' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER privacy_notice_machine
  BEFORE INSERT OR UPDATE OR DELETE ON sf_consent_privacy.privacy_notice
  FOR EACH ROW
  EXECUTE FUNCTION sf_consent_privacy.enforce_notice_publish_machine();
ALTER FUNCTION sf_consent_privacy.enforce_notice_publish_machine() OWNER TO sf_migrator;

CREATE FUNCTION sf_consent_privacy.enforce_consent_withdraw_machine()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_consent_privacy, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'GRANTED' THEN
      RAISE EXCEPTION 'consent insert must be GRANTED'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'WITHDRAWN' THEN
      -- Idempotent withdraw: allow no-op updates that keep WITHDRAWN.
      IF NEW.status IS DISTINCT FROM 'WITHDRAWN'
         OR NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at
         OR NEW.version IS DISTINCT FROM OLD.version THEN
        RAISE EXCEPTION 'withdrawn consent is immutable'
          USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.status IS DISTINCT FROM 'WITHDRAWN' OR NEW.withdrawn_at IS NULL THEN
      RAISE EXCEPTION 'granted consent may only withdraw'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.consent_id IS DISTINCT FROM OLD.consent_id
       OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
       OR NEW.purpose_id IS DISTINCT FROM OLD.purpose_id
       OR NEW.notice_id IS DISTINCT FROM OLD.notice_id
       OR NEW.applied_by IS DISTINCT FROM OLD.applied_by
       OR NEW.applied_for IS DISTINCT FROM OLD.applied_for
       OR NEW.representation_basis IS DISTINCT FROM OLD.representation_basis
       OR NEW.channel IS DISTINCT FROM OLD.channel
       OR NEW.granted_at IS DISTINCT FROM OLD.granted_at THEN
      RAISE EXCEPTION 'consent identity fields are immutable'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'consent delete is not permitted' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER consent_withdraw_machine
  BEFORE INSERT OR UPDATE OR DELETE ON sf_consent_privacy.consent
  FOR EACH ROW
  EXECUTE FUNCTION sf_consent_privacy.enforce_consent_withdraw_machine();
ALTER FUNCTION sf_consent_privacy.enforce_consent_withdraw_machine() OWNER TO sf_migrator;

REVOKE ALL ON ALL TABLES IN SCHEMA sf_consent_privacy FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_consent_privacy FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_consent_privacy FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE (status, version, updated_at) ON sf_consent_privacy.purpose TO sf_cmp030_rw;
GRANT SELECT, INSERT, UPDATE (status, published_at) ON sf_consent_privacy.privacy_notice TO sf_cmp030_rw;
GRANT SELECT, INSERT, UPDATE (status, withdrawn_at, version) ON sf_consent_privacy.consent TO sf_cmp030_rw;
GRANT SELECT, INSERT ON sf_consent_privacy.consent_event TO sf_cmp030_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_consent_privacy.idempotency_record TO sf_cmp030_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_consent_privacy.idempotency_record_platform TO sf_cmp030_rw;
GRANT EXECUTE ON FUNCTION sf_consent_privacy.enforce_notice_publish_machine() TO sf_cmp030_rw;
GRANT EXECUTE ON FUNCTION sf_consent_privacy.enforce_consent_withdraw_machine() TO sf_cmp030_rw;

ALTER TABLE sf_consent_privacy.purpose ALTER COLUMN label SET STATISTICS 0;
ALTER TABLE sf_consent_privacy.privacy_notice ALTER COLUMN content_ref SET STATISTICS 0;

-- Down Migration
REVOKE ALL ON SCHEMA sf_consent_privacy FROM sf_cmp030_rw;
DROP SCHEMA IF EXISTS sf_consent_privacy CASCADE;
DROP ROLE IF EXISTS sf_cmp030_rw;
