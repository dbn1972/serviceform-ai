-- CMP-049 Data Retention / Archival (SF-M08-005). ADR-0006 Option A: sf_cmp049_rw NOLOGIN holds DML;
-- FORCE RLS; PUBLIC revoked; runtime is not the table owner (sf_migrator).
-- POLICY-NEUTRAL machinery only (SF-CON-RETENTION-POLICY). No column stores a retention period,
-- day count, due date or erasure timeline: periods are owner-supplied statutory inputs and arrive
-- only as an opaque owner_supplied_period_ref. Archive/delete eligibility is refused at the
-- database as well as in the service while that ref is null (STATUTORY_RETENTION_POLICY_INPUT_REQUIRED).
-- Nothing here archives or deletes another component's data; owners act on emitted events.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp049_rw') THEN
    CREATE ROLE sf_cmp049_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp049_rw IS
  'ADR-0006: CMP-049 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_retention AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_retention IS
  'isolation_class=TENANT_SCOPED; owner=CMP-049; policy-neutral retention eligibility machinery';

REVOKE ALL ON SCHEMA sf_retention FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_retention TO sf_cmp049_rw;
GRANT USAGE ON SCHEMA sf_retention TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_retention REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_retention REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_retention REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_retention.retention_policy TENANT_SCOPED owner=CMP-049
CREATE TABLE sf_retention.retention_policy (
  tenant_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  policy_version bigint NOT NULL CHECK (policy_version >= 1),
  resource_type text NOT NULL CHECK (resource_type ~ '^[A-Z][A-Za-z0-9]{1,63}$'),
  service_code text CHECK (service_code IS NULL OR service_code ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'),
  jurisdiction_code text CHECK (
    jurisdiction_code IS NULL OR jurisdiction_code ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'
  ),
  owner_supplied_period_ref text CHECK (
    owner_supplied_period_ref IS NULL OR (
      owner_supplied_period_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$'
      AND owner_supplied_period_ref !~* '^([0-9]+[._ -]?(d|days?|w|wks?|weeks?|m|mos?|months?|y|yrs?|years?)?|p[0-9ymwdths.]*[0-9][0-9ymwdths.]*)$'
    )
  ),
  eligibility_transitions jsonb NOT NULL CHECK (
    jsonb_typeof(eligibility_transitions) = 'array'
    AND jsonb_array_length(eligibility_transitions) BETWEEN 1 AND 12
    AND octet_length(eligibility_transitions::text) <= 4096
  ),
  policy_neutral_shape boolean NOT NULL DEFAULT true CHECK (policy_neutral_shape),
  statutory_retention_policy_input_required boolean NOT NULL DEFAULT true
    CHECK (statutory_retention_policy_input_required),
  invented_statutory_period_forbidden boolean NOT NULL DEFAULT true
    CHECK (invented_statutory_period_forbidden),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  last_correlation_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, policy_id),
  CHECK (owner_supplied_period_ref IS NOT NULL OR policy_version = 1)
);
ALTER TABLE sf_retention.retention_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_retention.retention_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY retention_policy_isolation ON sf_retention.retention_policy TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_retention.retention_policy OWNER TO sf_migrator;

-- sf:isolation sf_retention.retention_subject TENANT_SCOPED owner=CMP-049
CREATE TABLE sf_retention.retention_subject (
  tenant_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  resource_type text NOT NULL CHECK (resource_type ~ '^[A-Z][A-Za-z0-9]{1,63}$'),
  resource_id uuid NOT NULL,
  eligibility text NOT NULL CHECK (
    eligibility IN ('ACTIVE', 'ARCHIVE_ELIGIBLE', 'DELETE_ELIGIBLE', 'LEGAL_HOLD')
  ),
  subject_version bigint NOT NULL CHECK (subject_version >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_correlation_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, subject_id),
  UNIQUE (tenant_id, resource_type, resource_id),
  FOREIGN KEY (tenant_id, policy_id) REFERENCES sf_retention.retention_policy (tenant_id, policy_id)
);
CREATE INDEX retention_subject_policy_idx
  ON sf_retention.retention_subject (tenant_id, policy_id, eligibility);
ALTER TABLE sf_retention.retention_subject ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_retention.retention_subject FORCE ROW LEVEL SECURITY;
CREATE POLICY retention_subject_isolation ON sf_retention.retention_subject TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_retention.retention_subject OWNER TO sf_migrator;

-- sf:isolation sf_retention.retention_transition_log TENANT_SCOPED owner=CMP-049
CREATE TABLE sf_retention.retention_transition_log (
  tenant_id uuid NOT NULL,
  transition_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  policy_version bigint NOT NULL CHECK (policy_version >= 1),
  from_eligibility text NOT NULL CHECK (
    from_eligibility IN ('ACTIVE', 'ARCHIVE_ELIGIBLE', 'DELETE_ELIGIBLE', 'LEGAL_HOLD')
  ),
  to_eligibility text NOT NULL CHECK (
    to_eligibility IN ('ACTIVE', 'ARCHIVE_ELIGIBLE', 'DELETE_ELIGIBLE', 'LEGAL_HOLD')
  ),
  owner_supplied_period_ref text,
  reason_code text CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  subject_version bigint NOT NULL CHECK (subject_version >= 2),
  actor_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  transitioned_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, transition_id),
  UNIQUE (tenant_id, subject_id, subject_version),
  FOREIGN KEY (tenant_id, subject_id) REFERENCES sf_retention.retention_subject (tenant_id, subject_id),
  CHECK (from_eligibility <> to_eligibility),
  CHECK (
    to_eligibility NOT IN ('ARCHIVE_ELIGIBLE', 'DELETE_ELIGIBLE')
    OR owner_supplied_period_ref IS NOT NULL
  )
);
ALTER TABLE sf_retention.retention_transition_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_retention.retention_transition_log FORCE ROW LEVEL SECURITY;
CREATE POLICY retention_transition_log_isolation ON sf_retention.retention_transition_log TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_retention.retention_transition_log OWNER TO sf_migrator;

-- sf:isolation sf_retention.idempotency_record TENANT_SCOPED owner=CMP-049
CREATE TABLE sf_retention.idempotency_record (
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
ALTER TABLE sf_retention.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_retention.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_isolation ON sf_retention.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_retention.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_retention.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_retention, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'insert-only retention row' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sf_retention.reject_mutation() OWNER TO sf_migrator;

CREATE TRIGGER retention_transition_log_immutable
  BEFORE UPDATE OR DELETE ON sf_retention.retention_transition_log
  FOR EACH ROW EXECUTE FUNCTION sf_retention.reject_mutation();

-- A registered policy is immutable except for the one-time binding of the owner period ref.
CREATE FUNCTION sf_retention.guard_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_retention, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'retention policies are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.policy_version <> 1 THEN
      RAISE EXCEPTION 'a retention policy is registered at version 1'
        USING ERRCODE = 'P0001', HINT = 'SF_STALE_VERSION';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.policy_id, NEW.resource_type, NEW.service_code, NEW.jurisdiction_code,
      NEW.eligibility_transitions, NEW.created_at, NEW.created_by)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.policy_id, OLD.resource_type, OLD.service_code, OLD.jurisdiction_code,
      OLD.eligibility_transitions, OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION 'published retention policy is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.owner_supplied_period_ref IS NOT NULL THEN
    RAISE EXCEPTION 'owner period ref is bound once and never replaced'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  IF NEW.owner_supplied_period_ref IS NULL THEN
    RAISE EXCEPTION 'only the owner period ref binding may update a policy'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  IF NEW.policy_version <> OLD.policy_version + 1 THEN
    RAISE EXCEPTION 'policy_version must advance by one'
      USING ERRCODE = 'P0001', HINT = 'SF_STALE_VERSION';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_retention.guard_policy() OWNER TO sf_migrator;

CREATE TRIGGER retention_policy_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_retention.retention_policy
  FOR EACH ROW EXECUTE FUNCTION sf_retention.guard_policy();

-- Enrolment starts ACTIVE; any later move must be listed by the policy and, for archive/delete
-- eligibility, the policy must carry an owner period ref. Runs as the invoker, so RLS applies.
CREATE FUNCTION sf_retention.guard_subject()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_retention, pg_temp
AS $$
DECLARE
  pol sf_retention.retention_policy%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'retention subjects are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.eligibility <> 'ACTIVE' OR NEW.subject_version <> 1 THEN
      RAISE EXCEPTION 'a retention subject is enrolled ACTIVE at version 1'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
    SELECT * INTO pol FROM sf_retention.retention_policy
     WHERE tenant_id = NEW.tenant_id AND policy_id = NEW.policy_id;
    IF NOT FOUND OR pol.resource_type <> NEW.resource_type THEN
      RAISE EXCEPTION 'subject resource_type must match the policy scope'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.subject_id, NEW.policy_id, NEW.resource_type, NEW.resource_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.subject_id, OLD.policy_id, OLD.resource_type, OLD.resource_id, OLD.created_at) THEN
    RAISE EXCEPTION 'retention subject identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.subject_version <> OLD.subject_version + 1 THEN
    RAISE EXCEPTION 'subject_version must advance by one'
      USING ERRCODE = 'P0001', HINT = 'SF_STALE_VERSION';
  END IF;
  IF NEW.eligibility = OLD.eligibility THEN
    RAISE EXCEPTION 'an eligibility transition must change state'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  SELECT * INTO pol FROM sf_retention.retention_policy
   WHERE tenant_id = NEW.tenant_id AND policy_id = NEW.policy_id;
  IF NOT FOUND OR NOT (pol.eligibility_transitions @> jsonb_build_array(
       jsonb_build_object('from_eligibility', OLD.eligibility, 'to_eligibility', NEW.eligibility))) THEN
    RAISE EXCEPTION 'transition not permitted by the retention policy'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  IF NEW.eligibility IN ('ARCHIVE_ELIGIBLE', 'DELETE_ELIGIBLE') AND pol.owner_supplied_period_ref IS NULL THEN
    RAISE EXCEPTION 'POLICY_INPUT_REQUIRED: owner-supplied period ref is missing'
      USING ERRCODE = 'P0001', HINT = 'SF_POLICY_INPUT_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_retention.guard_subject() OWNER TO sf_migrator;

CREATE TRIGGER retention_subject_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_retention.retention_subject
  FOR EACH ROW EXECUTE FUNCTION sf_retention.guard_subject();

REVOKE ALL ON ALL TABLES IN SCHEMA sf_retention FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_retention FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sf_retention FROM PUBLIC;

GRANT SELECT, INSERT,
  UPDATE (owner_supplied_period_ref, policy_version, updated_at, last_correlation_id)
  ON sf_retention.retention_policy TO sf_cmp049_rw;
GRANT SELECT, INSERT,
  UPDATE (eligibility, subject_version, updated_at, last_correlation_id)
  ON sf_retention.retention_subject TO sf_cmp049_rw;
GRANT SELECT, INSERT ON sf_retention.retention_transition_log TO sf_cmp049_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (status, response_ref, response_status, response_body)
  ON sf_retention.idempotency_record TO sf_cmp049_rw;

GRANT EXECUTE ON FUNCTION sf_retention.reject_mutation() TO sf_cmp049_rw;
GRANT EXECUTE ON FUNCTION sf_retention.guard_policy() TO sf_cmp049_rw;
GRANT EXECUTE ON FUNCTION sf_retention.guard_subject() TO sf_cmp049_rw;

-- Down Migration
REVOKE ALL ON SCHEMA sf_retention FROM sf_cmp049_rw;
REVOKE ALL ON SCHEMA sf_retention FROM sf_app;
DROP SCHEMA IF EXISTS sf_retention CASCADE;
-- Role sf_cmp049_rw retained (may be referenced by runtime logins); never DROP ROLE here.
