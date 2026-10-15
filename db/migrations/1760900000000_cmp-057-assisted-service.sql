-- CMP-057 Assisted Service / Omnichannel (SF-M09-002). ADR-0006 Option A: sf_cmp057_rw NOLOGIN
-- holds DML; FORCE RLS; PUBLIC revoked; runtime is not the table owner (sf_migrator).
-- SF-CON-ASSISTED-SESSION: applied_by MUST be distinct from applied_for (CHECK + guard).
-- Representation authority is an opaque owner-supplied ref only — no representation statute,
-- guardian calendar, or eligibility rule is invented here (INT-015).
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp057_rw') THEN
    CREATE ROLE sf_cmp057_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp057_rw IS
  'ADR-0006: CMP-057 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_assisted AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_assisted IS
  'isolation_class=TENANT_SCOPED; owner=CMP-057; assisted/omnichannel session lifecycle (INT-015)';

REVOKE ALL ON SCHEMA sf_assisted FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_assisted TO sf_cmp057_rw;
GRANT USAGE ON SCHEMA sf_assisted TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_assisted REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_assisted REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_assisted REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_assisted.assisted_session TENANT_SCOPED owner=CMP-057
CREATE TABLE sf_assisted.assisted_session (
  tenant_id uuid NOT NULL,
  session_id uuid NOT NULL,
  channel text NOT NULL CHECK (
    channel IN (
      'COUNTER', 'CSC', 'KIOSK', 'CALL_CENTRE',
      'AUTHORIZED_REPRESENTATIVE', 'GUARDIAN', 'INSTITUTIONAL'
    )
  ),
  applied_by_actor_id uuid NOT NULL,
  applied_by_actor_type text NOT NULL CHECK (
    applied_by_actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')
  ),
  applied_for_citizen_id uuid NOT NULL,
  applied_by_distinct_from_applied_for boolean NOT NULL DEFAULT true
    CHECK (applied_by_distinct_from_applied_for),
  invented_statutory_policy_forbidden boolean NOT NULL DEFAULT true
    CHECK (invented_statutory_policy_forbidden),
  organisation_id uuid,
  office_id uuid,
  lifecycle_status text NOT NULL CHECK (
    lifecycle_status IN (
      'STARTED', 'APPLICANT_BOUND', 'REPRESENTATION_VERIFIED',
      'SUBMITTED', 'HANDED_OFF', 'CLOSED'
    )
  ),
  session_version bigint NOT NULL CHECK (session_version >= 1),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  applicant_assurance_ref text CHECK (
    applicant_assurance_ref IS NULL OR applicant_assurance_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'
  ),
  application_id uuid,
  handoff_token_hash text CHECK (
    handoff_token_hash IS NULL OR handoff_token_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  handoff_expires_at timestamptz,
  closure_reason text CHECK (
    closure_reason IS NULL OR closure_reason IN ('OPERATOR_CLOSED', 'RESUMED_SELF_SERVICE')
  ),
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_correlation_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, session_id),
  CHECK (applied_by_actor_id <> applied_for_citizen_id),
  CHECK (
    (lifecycle_status = 'CLOSED' AND closure_reason IS NOT NULL)
    OR (lifecycle_status <> 'CLOSED' AND closure_reason IS NULL)
  ),
  CHECK (
    (handoff_token_hash IS NULL) = (handoff_expires_at IS NULL)
  )
);
CREATE INDEX assisted_session_applicant_idx
  ON sf_assisted.assisted_session (tenant_id, applied_for_citizen_id, lifecycle_status);
CREATE INDEX assisted_session_operator_idx
  ON sf_assisted.assisted_session (tenant_id, applied_by_actor_id, lifecycle_status);
ALTER TABLE sf_assisted.assisted_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_assisted.assisted_session FORCE ROW LEVEL SECURITY;
CREATE POLICY assisted_session_isolation ON sf_assisted.assisted_session TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_assisted.assisted_session OWNER TO sf_migrator;

-- sf:isolation sf_assisted.representation_authority TENANT_SCOPED owner=CMP-057
-- Opaque owner-supplied ref only; CMP-057 never interprets representation statute.
CREATE TABLE sf_assisted.representation_authority (
  tenant_id uuid NOT NULL,
  representation_id uuid NOT NULL,
  session_id uuid NOT NULL,
  representation_authority_ref text CHECK (
    representation_authority_ref IS NULL
    OR representation_authority_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'
  ),
  valid_until timestamptz,
  verified_by_actor_id uuid NOT NULL,
  verified_by_actor_type text NOT NULL CHECK (
    verified_by_actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')
  ),
  verified_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, representation_id),
  UNIQUE (tenant_id, session_id),
  FOREIGN KEY (tenant_id, session_id)
    REFERENCES sf_assisted.assisted_session (tenant_id, session_id),
  CHECK (verified_by_actor_id IS NOT NULL)
);
ALTER TABLE sf_assisted.representation_authority ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_assisted.representation_authority FORCE ROW LEVEL SECURITY;
CREATE POLICY representation_authority_isolation ON sf_assisted.representation_authority TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_assisted.representation_authority OWNER TO sf_migrator;

-- sf:isolation sf_assisted.assisted_consent TENANT_SCOPED owner=CMP-057
CREATE TABLE sf_assisted.assisted_consent (
  tenant_id uuid NOT NULL,
  consent_record_id uuid NOT NULL,
  session_id uuid NOT NULL,
  consent_ref text NOT NULL CHECK (consent_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  read_back_acknowledged boolean NOT NULL DEFAULT true CHECK (read_back_acknowledged),
  captured_by_actor_id uuid NOT NULL,
  captured_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, consent_record_id),
  UNIQUE (tenant_id, session_id),
  FOREIGN KEY (tenant_id, session_id)
    REFERENCES sf_assisted.assisted_session (tenant_id, session_id)
);
ALTER TABLE sf_assisted.assisted_consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_assisted.assisted_consent FORCE ROW LEVEL SECURITY;
CREATE POLICY assisted_consent_isolation ON sf_assisted.assisted_consent TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_assisted.assisted_consent OWNER TO sf_migrator;

-- sf:isolation sf_assisted.operator_action_audit TENANT_SCOPED owner=CMP-057
CREATE TABLE sf_assisted.operator_action_audit (
  tenant_id uuid NOT NULL,
  action_id uuid NOT NULL,
  session_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 1),
  command text NOT NULL CHECK (
    command IN (
      'START', 'BIND_APPLICANT', 'VERIFY_REPRESENTATION',
      'SUBMIT', 'HANDOFF', 'RESUME', 'CLOSE'
    )
  ),
  from_status text CHECK (
    from_status IS NULL OR from_status IN (
      'STARTED', 'APPLICANT_BOUND', 'REPRESENTATION_VERIFIED',
      'SUBMITTED', 'HANDED_OFF', 'CLOSED'
    )
  ),
  to_status text NOT NULL CHECK (
    to_status IN (
      'STARTED', 'APPLICANT_BOUND', 'REPRESENTATION_VERIFIED',
      'SUBMITTED', 'HANDED_OFF', 'CLOSED'
    )
  ),
  actor_type text NOT NULL CHECK (
    actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')
  ),
  actor_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  acted_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, action_id),
  UNIQUE (tenant_id, session_id, sequence),
  FOREIGN KEY (tenant_id, session_id)
    REFERENCES sf_assisted.assisted_session (tenant_id, session_id)
);
ALTER TABLE sf_assisted.operator_action_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_assisted.operator_action_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY operator_action_audit_isolation ON sf_assisted.operator_action_audit TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_assisted.operator_action_audit OWNER TO sf_migrator;

-- sf:isolation sf_assisted.idempotency_record TENANT_SCOPED owner=CMP-057
CREATE TABLE sf_assisted.idempotency_record (
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
ALTER TABLE sf_assisted.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_assisted.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_assisted.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_assisted.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_assisted.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_assisted, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'insert-only assisted row' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_assisted.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER representation_authority_immutable
  BEFORE UPDATE OR DELETE ON sf_assisted.representation_authority
  FOR EACH ROW EXECUTE FUNCTION sf_assisted.reject_mutation();

CREATE TRIGGER assisted_consent_immutable
  BEFORE UPDATE OR DELETE ON sf_assisted.assisted_consent
  FOR EACH ROW EXECUTE FUNCTION sf_assisted.reject_mutation();

CREATE TRIGGER operator_action_audit_immutable
  BEFORE UPDATE OR DELETE ON sf_assisted.operator_action_audit
  FOR EACH ROW EXECUTE FUNCTION sf_assisted.reject_mutation();

-- Lifecycle and identity guards (mirrors service COMMAND_SOURCES / INT-015 step 2).
CREATE FUNCTION sf_assisted.guard_session()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_assisted, pg_temp
AS $$
DECLARE
  needs_rep boolean;
  has_rep boolean;
  has_consent boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'assisted sessions are never deleted' USING ERRCODE = '42501';
  END IF;

  IF NEW.applied_by_actor_id = NEW.applied_for_citizen_id
     OR NEW.applied_by_distinct_from_applied_for IS NOT TRUE THEN
    RAISE EXCEPTION 'applied_by must be distinct from applied_for'
      USING ERRCODE = 'P0001', HINT = 'SF_APPLIED_BY_NOT_DISTINCT';
  END IF;

  IF NEW.invented_statutory_policy_forbidden IS NOT TRUE THEN
    RAISE EXCEPTION 'invented representation statute forbidden'
      USING ERRCODE = 'P0001', HINT = 'SF_STATUTORY_INVENTION_FORBIDDEN';
  END IF;

  needs_rep := NEW.channel IN ('AUTHORIZED_REPRESENTATIVE', 'GUARDIAN', 'INSTITUTIONAL');

  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_status <> 'STARTED' OR NEW.session_version <> 1 THEN
      RAISE EXCEPTION 'an assisted session starts STARTED at version 1'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
    IF NEW.applicant_assurance_ref IS NOT NULL
       OR NEW.application_id IS NOT NULL
       OR NEW.handoff_token_hash IS NOT NULL
       OR NEW.closure_reason IS NOT NULL THEN
      RAISE EXCEPTION 'a new assisted session carries no binding or handoff yet'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
    IF needs_rep AND NEW.applied_by_actor_type NOT IN ('CITIZEN', 'OFFICER') THEN
      RAISE EXCEPTION 'representation channel starter must be CITIZEN or OFFICER'
        USING ERRCODE = 'P0001', HINT = 'SF_ACTOR_NOT_PERMITTED';
    END IF;
    IF NOT needs_rep AND NEW.applied_by_actor_type <> 'OFFICER' THEN
      RAISE EXCEPTION 'counter/csc/kiosk/call-centre starter must be OFFICER'
        USING ERRCODE = 'P0001', HINT = 'SF_ACTOR_NOT_PERMITTED';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.tenant_id, NEW.session_id, NEW.channel, NEW.applied_by_actor_id,
      NEW.applied_by_actor_type, NEW.applied_for_citizen_id, NEW.started_at,
      NEW.idempotency_key)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.session_id, OLD.channel, OLD.applied_by_actor_id,
      OLD.applied_by_actor_type, OLD.applied_for_citizen_id, OLD.started_at,
      OLD.idempotency_key) THEN
    RAISE EXCEPTION 'assisted session identity is immutable' USING ERRCODE = '42501';
  END IF;

  IF NEW.session_version <> OLD.session_version + 1 THEN
    RAISE EXCEPTION 'session_version must advance by one'
      USING ERRCODE = 'P0001', HINT = 'SF_STALE_VERSION';
  END IF;

  IF OLD.lifecycle_status = 'CLOSED' THEN
    RAISE EXCEPTION 'CLOSED sessions are terminal'
      USING ERRCODE = 'P0001', HINT = 'SF_TERMINAL_STATUS';
  END IF;

  IF NEW.lifecycle_status = OLD.lifecycle_status THEN
    RAISE EXCEPTION 'a session command must change lifecycle_status'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;

  IF NOT (
       (OLD.lifecycle_status = 'STARTED' AND NEW.lifecycle_status IN ('APPLICANT_BOUND', 'CLOSED'))
    OR (OLD.lifecycle_status = 'APPLICANT_BOUND'
        AND NEW.lifecycle_status IN ('REPRESENTATION_VERIFIED', 'CLOSED'))
    OR (OLD.lifecycle_status = 'REPRESENTATION_VERIFIED'
        AND NEW.lifecycle_status IN ('SUBMITTED', 'HANDED_OFF', 'CLOSED'))
    OR (OLD.lifecycle_status = 'SUBMITTED' AND NEW.lifecycle_status = 'CLOSED')
    OR (OLD.lifecycle_status = 'HANDED_OFF' AND NEW.lifecycle_status = 'CLOSED')
  ) THEN
    RAISE EXCEPTION 'transition not permitted for assisted session'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;

  IF NEW.lifecycle_status = 'APPLICANT_BOUND' THEN
    IF NEW.applicant_assurance_ref IS NULL THEN
      RAISE EXCEPTION 'applicant binding requires an opaque assurance ref'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
  END IF;

  IF NEW.lifecycle_status = 'REPRESENTATION_VERIFIED' THEN
    SELECT EXISTS (
      SELECT 1 FROM sf_assisted.representation_authority r
       WHERE r.tenant_id = NEW.tenant_id AND r.session_id = NEW.session_id
    ) INTO has_rep;
    SELECT EXISTS (
      SELECT 1 FROM sf_assisted.assisted_consent c
       WHERE c.tenant_id = NEW.tenant_id AND c.session_id = NEW.session_id
    ) INTO has_consent;
    IF NOT has_rep OR NOT has_consent THEN
      RAISE EXCEPTION 'representation and consent must be recorded before REPRESENTATION_VERIFIED'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
    IF needs_rep THEN
      IF NOT EXISTS (
        SELECT 1 FROM sf_assisted.representation_authority r
         WHERE r.tenant_id = NEW.tenant_id AND r.session_id = NEW.session_id
           AND r.representation_authority_ref IS NOT NULL
           AND r.verified_by_actor_id <> NEW.applied_by_actor_id
           AND r.verified_by_actor_id <> NEW.applied_for_citizen_id
      ) THEN
        RAISE EXCEPTION 'representation channel requires a third-party verified opaque authority ref'
          USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
      END IF;
    END IF;
  END IF;

  IF NEW.lifecycle_status IN ('SUBMITTED', 'HANDED_OFF') THEN
    IF NEW.application_id IS NULL THEN
      RAISE EXCEPTION 'submit/handoff requires an application_id'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM sf_assisted.representation_authority r
       WHERE r.tenant_id = NEW.tenant_id AND r.session_id = NEW.session_id
    ) OR NOT EXISTS (
      SELECT 1 FROM sf_assisted.assisted_consent c
       WHERE c.tenant_id = NEW.tenant_id AND c.session_id = NEW.session_id
    ) THEN
      RAISE EXCEPTION 'submit/handoff requires prior representation and consent'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
  END IF;

  IF NEW.lifecycle_status = 'HANDED_OFF' THEN
    IF NEW.handoff_token_hash IS NULL OR NEW.handoff_expires_at IS NULL THEN
      RAISE EXCEPTION 'handoff requires a hashed token and expiry'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
  END IF;

  IF NEW.lifecycle_status = 'CLOSED' AND OLD.lifecycle_status = 'HANDED_OFF' THEN
    IF NEW.application_id IS DISTINCT FROM OLD.application_id
       OR NEW.applied_for_citizen_id IS DISTINCT FROM OLD.applied_for_citizen_id THEN
      RAISE EXCEPTION 'resume must preserve citizen_id and application identity'
        USING ERRCODE = 'P0001', HINT = 'SF_IDENTITY_IMMUTABLE';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_assisted.guard_session() OWNER TO sf_migrator;

CREATE TRIGGER assisted_session_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_assisted.assisted_session
  FOR EACH ROW EXECUTE FUNCTION sf_assisted.guard_session();

-- Representation row: verifier must be distinct from both parties when a ref is present.
CREATE FUNCTION sf_assisted.guard_representation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_assisted, pg_temp
AS $$
DECLARE
  sess sf_assisted.assisted_session%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'representation_authority is insert-only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO sess FROM sf_assisted.assisted_session
   WHERE tenant_id = NEW.tenant_id AND session_id = NEW.session_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found for representation' USING ERRCODE = '23503';
  END IF;
  IF sess.lifecycle_status <> 'APPLICANT_BOUND' THEN
    RAISE EXCEPTION 'representation may only be recorded from APPLICANT_BOUND'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  -- Third-party verification is required only on representation channels (INT-015 step 2).
  -- Counter/CSC/kiosk/call-centre operators record their own read-back + consent.
  IF sess.channel IN ('AUTHORIZED_REPRESENTATIVE', 'GUARDIAN', 'INSTITUTIONAL') THEN
    IF NEW.verified_by_actor_id = sess.applied_by_actor_id
       OR NEW.verified_by_actor_id = sess.applied_for_citizen_id THEN
      RAISE EXCEPTION 'representation verifier must be distinct from applied_by and applied_for'
        USING ERRCODE = 'P0001', HINT = 'SF_SELF_VERIFICATION_REFUSED';
    END IF;
    IF NEW.representation_authority_ref IS NULL THEN
      RAISE EXCEPTION 'representation channel requires an opaque authority ref'
        USING ERRCODE = 'P0001', HINT = 'SF_REPRESENTATION_REF_REQUIRED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_assisted.guard_representation() OWNER TO sf_migrator;

CREATE TRIGGER representation_authority_guard
  BEFORE INSERT ON sf_assisted.representation_authority
  FOR EACH ROW EXECUTE FUNCTION sf_assisted.guard_representation();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_assisted FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_assisted FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_assisted FROM PUBLIC;

GRANT SELECT, INSERT,
  UPDATE (
    lifecycle_status, session_version, applicant_assurance_ref, application_id,
    handoff_token_hash, handoff_expires_at, closure_reason, updated_at, last_correlation_id
  )
  ON sf_assisted.assisted_session TO sf_cmp057_rw;
GRANT SELECT, INSERT ON sf_assisted.representation_authority TO sf_cmp057_rw;
GRANT SELECT, INSERT ON sf_assisted.assisted_consent TO sf_cmp057_rw;
GRANT SELECT, INSERT ON sf_assisted.operator_action_audit TO sf_cmp057_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_assisted.idempotency_record TO sf_cmp057_rw;

GRANT EXECUTE ON FUNCTION sf_assisted.reject_mutation() TO sf_cmp057_rw;
GRANT EXECUTE ON FUNCTION sf_assisted.guard_session() TO sf_cmp057_rw;
GRANT EXECUTE ON FUNCTION sf_assisted.guard_representation() TO sf_cmp057_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_assisted FROM sf_cmp057_rw;
REVOKE ALL ON SCHEMA sf_assisted FROM sf_app;
DROP SCHEMA IF EXISTS sf_assisted CASCADE;
-- Role sf_cmp057_rw retained (may be referenced by runtime logins); never DROP ROLE here.
