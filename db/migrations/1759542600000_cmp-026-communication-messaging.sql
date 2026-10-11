-- CMP-026 Communication / Messaging (SF-M06-003). ADR-0006 Option A: sf_cmp026_rw NOLOGIN
-- holds DML; FORCE RLS; PUBLIC revoked; runtime is not table owner (sf_migrator).
-- Tenant-scoped, case-scoped, participant-scoped threads (SF-CON-MESSAGE-THREAD).
-- Messages, notices, acknowledgements and retractions are append-only: a retracted (UI-deleted)
-- message keeps its row for audit. Attachments are CMP-032 storage-key references only; this
-- schema owns no object-store state. Opaque application_id linkage; no cross-component SQL.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp026_rw') THEN
    CREATE ROLE sf_cmp026_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp026_rw IS
  'ADR-0006: CMP-026 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_messaging AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_messaging IS
  'isolation_class=TENANT_SCOPED; owner=CMP-026; case-scoped threads, participants, messages, notices, acknowledgements';

REVOKE ALL ON SCHEMA sf_messaging FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_messaging TO sf_cmp026_rw;
GRANT USAGE ON SCHEMA sf_messaging TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_messaging REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_messaging REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_messaging REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_messaging.thread TENANT_SCOPED owner=CMP-026
CREATE TABLE sf_messaging.thread (
  thread_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  application_id uuid NOT NULL,
  subject_code text CHECK (subject_code IS NULL OR subject_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  status text NOT NULL CHECK (status IN ('OPEN', 'CLOSED', 'ARCHIVED')),
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 1),
  message_seq bigint NOT NULL DEFAULT 0 CHECK (message_seq >= 0),
  organisation_id uuid,
  jurisdiction_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_correlation_id uuid NOT NULL,
  UNIQUE (tenant_id, thread_id)
);
CREATE INDEX thread_application_idx ON sf_messaging.thread (tenant_id, application_id, created_at DESC);
ALTER TABLE sf_messaging.thread ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_messaging.thread FORCE ROW LEVEL SECURITY;
CREATE POLICY thread_tenant ON sf_messaging.thread TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_messaging.thread OWNER TO sf_migrator;

-- sf:isolation sf_messaging.thread_transition TENANT_SCOPED owner=CMP-026
CREATE TABLE sf_messaging.thread_transition (
  transition_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  command text NOT NULL CHECK (command ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  from_status text,
  to_status text NOT NULL,
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 1),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  authz_decision_id uuid NOT NULL,
  authz_policy_revision text NOT NULL CHECK (char_length(authz_policy_revision) BETWEEN 1 AND 128),
  correlation_id uuid NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (tenant_id, thread_id, aggregate_version),
  FOREIGN KEY (tenant_id, thread_id) REFERENCES sf_messaging.thread (tenant_id, thread_id)
);
ALTER TABLE sf_messaging.thread_transition ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_messaging.thread_transition FORCE ROW LEVEL SECURITY;
CREATE POLICY thread_transition_tenant ON sf_messaging.thread_transition TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_messaging.thread_transition OWNER TO sf_migrator;

-- sf:isolation sf_messaging.participant TENANT_SCOPED owner=CMP-026
CREATE TABLE sf_messaging.participant (
  participant_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  participant_ref text NOT NULL CHECK (char_length(participant_ref) BETWEEN 1 AND 128),
  role_code text NOT NULL CHECK (role_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  added_by uuid NOT NULL,
  added_at timestamptz NOT NULL,
  removed_at timestamptz,
  removed_by uuid,
  UNIQUE (tenant_id, thread_id, actor_id),
  UNIQUE (tenant_id, thread_id, participant_ref),
  CHECK ((removed_at IS NULL) = (removed_by IS NULL)),
  FOREIGN KEY (tenant_id, thread_id) REFERENCES sf_messaging.thread (tenant_id, thread_id)
);
CREATE INDEX participant_actor_idx ON sf_messaging.participant (tenant_id, actor_id, thread_id);
ALTER TABLE sf_messaging.participant ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_messaging.participant FORCE ROW LEVEL SECURITY;
CREATE POLICY participant_tenant ON sf_messaging.participant TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_messaging.participant OWNER TO sf_migrator;

-- sf:isolation sf_messaging.message TENANT_SCOPED owner=CMP-026
CREATE TABLE sf_messaging.message (
  message_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 1),
  kind text NOT NULL CHECK (kind IN ('MESSAGE', 'OFFICIAL_NOTICE')),
  sender_actor_type text NOT NULL CHECK (sender_actor_type IN ('CITIZEN', 'OFFICER', 'SYSTEM', 'INTEGRATION', 'PRIVILEGED_ADMIN')),
  sender_id uuid NOT NULL,
  sender_participant_ref text NOT NULL CHECK (char_length(sender_participant_ref) BETWEEN 1 AND 128),
  body_text text NOT NULL CHECK (char_length(body_text) BETWEEN 1 AND 8000),
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  ack_required boolean NOT NULL DEFAULT false,
  ack_due_at timestamptz,
  created_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  UNIQUE (tenant_id, message_id),
  UNIQUE (tenant_id, thread_id, sequence),
  CHECK (kind = 'OFFICIAL_NOTICE' OR (ack_required = false AND ack_due_at IS NULL)),
  CHECK (ack_due_at IS NULL OR ack_required),
  FOREIGN KEY (tenant_id, thread_id) REFERENCES sf_messaging.thread (tenant_id, thread_id)
);
ALTER TABLE sf_messaging.message ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_messaging.message FORCE ROW LEVEL SECURITY;
CREATE POLICY message_tenant ON sf_messaging.message TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_messaging.message OWNER TO sf_migrator;

-- sf:isolation sf_messaging.message_attachment TENANT_SCOPED owner=CMP-026
CREATE TABLE sf_messaging.message_attachment (
  attachment_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  message_id uuid NOT NULL,
  storage_key text NOT NULL CHECK (
    char_length(storage_key) BETWEEN 8 AND 256
    AND storage_key ~ '^[A-Za-z0-9_./:-]+$'
    AND storage_key NOT LIKE '%..%'
  ),
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  scan_verdict text NOT NULL CHECK (scan_verdict = 'CLEAN'),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, attachment_id),
  UNIQUE (tenant_id, message_id, storage_key),
  FOREIGN KEY (tenant_id, message_id) REFERENCES sf_messaging.message (tenant_id, message_id),
  FOREIGN KEY (tenant_id, thread_id) REFERENCES sf_messaging.thread (tenant_id, thread_id)
);
ALTER TABLE sf_messaging.message_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_messaging.message_attachment FORCE ROW LEVEL SECURITY;
CREATE POLICY message_attachment_tenant ON sf_messaging.message_attachment TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_messaging.message_attachment OWNER TO sf_migrator;

-- sf:isolation sf_messaging.message_retraction TENANT_SCOPED owner=CMP-026
CREATE TABLE sf_messaging.message_retraction (
  retraction_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  message_id uuid NOT NULL,
  retracted_by uuid NOT NULL,
  reason_code text CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  retracted_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  UNIQUE (tenant_id, message_id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES sf_messaging.message (tenant_id, message_id)
);
ALTER TABLE sf_messaging.message_retraction ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_messaging.message_retraction FORCE ROW LEVEL SECURITY;
CREATE POLICY message_retraction_tenant ON sf_messaging.message_retraction TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_messaging.message_retraction OWNER TO sf_migrator;

-- sf:isolation sf_messaging.notice_acknowledgement TENANT_SCOPED owner=CMP-026
CREATE TABLE sf_messaging.notice_acknowledgement (
  ack_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  message_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  acknowledged_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  UNIQUE (tenant_id, message_id, actor_id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES sf_messaging.message (tenant_id, message_id)
);
ALTER TABLE sf_messaging.notice_acknowledgement ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_messaging.notice_acknowledgement FORCE ROW LEVEL SECURITY;
CREATE POLICY notice_acknowledgement_tenant ON sf_messaging.notice_acknowledgement TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_messaging.notice_acknowledgement OWNER TO sf_migrator;

-- sf:isolation sf_messaging.read_receipt TENANT_SCOPED owner=CMP-026
CREATE TABLE sf_messaging.read_receipt (
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  last_read_sequence bigint NOT NULL CHECK (last_read_sequence >= 0),
  read_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, thread_id, actor_id),
  FOREIGN KEY (tenant_id, thread_id) REFERENCES sf_messaging.thread (tenant_id, thread_id)
);
ALTER TABLE sf_messaging.read_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_messaging.read_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY read_receipt_tenant ON sf_messaging.read_receipt TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_messaging.read_receipt OWNER TO sf_migrator;

-- sf:isolation sf_messaging.idempotency_record TENANT_SCOPED owner=CMP-026
CREATE TABLE sf_messaging.idempotency_record (
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
ALTER TABLE sf_messaging.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_messaging.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_tenant ON sf_messaging.idempotency_record TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_messaging.idempotency_record OWNER TO sf_migrator;

CREATE FUNCTION sf_messaging.enforce_thread() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  legal constant text[] := ARRAY['OPEN>CLOSED', 'CLOSED>OPEN', 'CLOSED>ARCHIVED'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'thread rows are never deleted'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' OR NEW.aggregate_version <> 1 OR NEW.message_seq <> 0 THEN
      RAISE EXCEPTION 'a thread is created only as OPEN at aggregate_version 1 with no messages'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.thread_id, NEW.tenant_id, NEW.cell_id, NEW.application_id, NEW.subject_code,
      NEW.organisation_id, NEW.jurisdiction_id, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.thread_id, OLD.tenant_id, OLD.cell_id, OLD.application_id, OLD.subject_code,
      OLD.organisation_id, OLD.jurisdiction_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'thread identity columns are immutable'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.aggregate_version <> OLD.aggregate_version + 1 OR NEW.message_seq <> OLD.message_seq THEN
      RAISE EXCEPTION 'a status change advances aggregate_version by exactly one'
        USING ERRCODE = 'P0001', HINT = 'SF_STALE_VERSION';
    END IF;
    IF NOT ((OLD.status || '>' || NEW.status) = ANY (legal)) THEN
      RAISE EXCEPTION 'illegal thread transition'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
  ELSE
    IF NEW.aggregate_version <> OLD.aggregate_version OR NEW.message_seq <> OLD.message_seq + 1 THEN
      RAISE EXCEPTION 'message_seq advances by exactly one and only on an open thread'
        USING ERRCODE = 'P0001', HINT = 'SF_STALE_VERSION';
    END IF;
    IF OLD.status <> 'OPEN' THEN
      RAISE EXCEPTION 'thread is not open'
        USING ERRCODE = 'P0001', HINT = 'SF_THREAD_NOT_OPEN';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_messaging.enforce_thread() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_messaging.enforce_thread() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_messaging.enforce_thread() TO sf_cmp026_rw;

CREATE TRIGGER thread_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_messaging.thread
  FOR EACH ROW
  EXECUTE FUNCTION sf_messaging.enforce_thread();

CREATE FUNCTION sf_messaging.prevent_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'append-only messaging rows'
    USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
END
$$;
ALTER FUNCTION sf_messaging.prevent_mutation() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_messaging.prevent_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_messaging.prevent_mutation() TO sf_cmp026_rw;

CREATE TRIGGER thread_transition_immutable
  BEFORE UPDATE OR DELETE ON sf_messaging.thread_transition
  FOR EACH ROW EXECUTE FUNCTION sf_messaging.prevent_mutation();
CREATE TRIGGER message_immutable
  BEFORE UPDATE OR DELETE ON sf_messaging.message
  FOR EACH ROW EXECUTE FUNCTION sf_messaging.prevent_mutation();
CREATE TRIGGER message_attachment_immutable
  BEFORE UPDATE OR DELETE ON sf_messaging.message_attachment
  FOR EACH ROW EXECUTE FUNCTION sf_messaging.prevent_mutation();
CREATE TRIGGER message_retraction_immutable
  BEFORE UPDATE OR DELETE ON sf_messaging.message_retraction
  FOR EACH ROW EXECUTE FUNCTION sf_messaging.prevent_mutation();
CREATE TRIGGER notice_acknowledgement_immutable
  BEFORE UPDATE OR DELETE ON sf_messaging.notice_acknowledgement
  FOR EACH ROW EXECUTE FUNCTION sf_messaging.prevent_mutation();

CREATE FUNCTION sf_messaging.enforce_participant() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'participant rows are never deleted'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.removed_at IS NOT NULL THEN
      RAISE EXCEPTION 'a participant is added as active'
        USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.participant_id, NEW.tenant_id, NEW.thread_id, NEW.actor_id, NEW.participant_ref,
      NEW.role_code, NEW.added_by, NEW.added_at)
     IS DISTINCT FROM
     (OLD.participant_id, OLD.tenant_id, OLD.thread_id, OLD.actor_id, OLD.participant_ref,
      OLD.role_code, OLD.added_by, OLD.added_at) THEN
    RAISE EXCEPTION 'participant identity columns are immutable'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  IF OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL THEN
    RAISE EXCEPTION 'removal is one-way'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_messaging.enforce_participant() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_messaging.enforce_participant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_messaging.enforce_participant() TO sf_cmp026_rw;

CREATE TRIGGER participant_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_messaging.participant
  FOR EACH ROW EXECUTE FUNCTION sf_messaging.enforce_participant();

-- A message may only be appended to the current sequence of an OPEN thread by an active participant.
CREATE FUNCTION sf_messaging.enforce_message_insert() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sf_messaging.thread t
     WHERE t.tenant_id = NEW.tenant_id AND t.thread_id = NEW.thread_id
       AND t.status = 'OPEN' AND t.message_seq = NEW.sequence
  ) THEN
    RAISE EXCEPTION 'thread is not open or sequence is not current'
      USING ERRCODE = 'P0001', HINT = 'SF_THREAD_NOT_OPEN';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sf_messaging.participant p
     WHERE p.tenant_id = NEW.tenant_id AND p.thread_id = NEW.thread_id
       AND p.actor_id = NEW.sender_id AND p.removed_at IS NULL
       AND p.participant_ref = NEW.sender_participant_ref
  ) THEN
    RAISE EXCEPTION 'sender is not an active participant'
      USING ERRCODE = 'P0001', HINT = 'SF_NOT_PARTICIPANT';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_messaging.enforce_message_insert() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_messaging.enforce_message_insert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_messaging.enforce_message_insert() TO sf_cmp026_rw;

CREATE TRIGGER message_insert_guard
  BEFORE INSERT ON sf_messaging.message
  FOR EACH ROW EXECUTE FUNCTION sf_messaging.enforce_message_insert();

-- Only the author may retract, only plain messages (official notices are immutable), and the
-- retracting principal must be the original sender.
CREATE FUNCTION sf_messaging.enforce_retraction_insert() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sf_messaging.message m
     WHERE m.tenant_id = NEW.tenant_id AND m.message_id = NEW.message_id
       AND m.thread_id = NEW.thread_id AND m.kind = 'MESSAGE' AND m.sender_id = NEW.retracted_by
  ) THEN
    RAISE EXCEPTION 'only the sender may retract a plain message'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_messaging.enforce_retraction_insert() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_messaging.enforce_retraction_insert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_messaging.enforce_retraction_insert() TO sf_cmp026_rw;

CREATE TRIGGER message_retraction_guard
  BEFORE INSERT ON sf_messaging.message_retraction
  FOR EACH ROW EXECUTE FUNCTION sf_messaging.enforce_retraction_insert();

-- Acknowledgement applies only to an ack-required official notice, by an active participant
-- other than the sender.
CREATE FUNCTION sf_messaging.enforce_ack_insert() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sf_messaging.message m
     WHERE m.tenant_id = NEW.tenant_id AND m.message_id = NEW.message_id
       AND m.thread_id = NEW.thread_id AND m.kind = 'OFFICIAL_NOTICE'
       AND m.ack_required AND m.sender_id <> NEW.actor_id
  ) THEN
    RAISE EXCEPTION 'message is not an acknowledgeable notice for this actor'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sf_messaging.participant p
     WHERE p.tenant_id = NEW.tenant_id AND p.thread_id = NEW.thread_id
       AND p.actor_id = NEW.actor_id AND p.removed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'actor is not an active participant'
      USING ERRCODE = 'P0001', HINT = 'SF_NOT_PARTICIPANT';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_messaging.enforce_ack_insert() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_messaging.enforce_ack_insert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_messaging.enforce_ack_insert() TO sf_cmp026_rw;

CREATE TRIGGER notice_acknowledgement_guard
  BEFORE INSERT ON sf_messaging.notice_acknowledgement
  FOR EACH ROW EXECUTE FUNCTION sf_messaging.enforce_ack_insert();

-- Read position is monotonic, never beyond the thread's last message, and only for participants.
CREATE FUNCTION sf_messaging.enforce_read_receipt() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'read receipts are never deleted'
      USING ERRCODE = 'P0001', HINT = 'SF_RECORD_IMMUTABLE';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.last_read_sequence < OLD.last_read_sequence THEN
    RAISE EXCEPTION 'read position cannot move backwards'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sf_messaging.thread t
     WHERE t.tenant_id = NEW.tenant_id AND t.thread_id = NEW.thread_id
       AND t.message_seq >= NEW.last_read_sequence
  ) THEN
    RAISE EXCEPTION 'read position is beyond the last message'
      USING ERRCODE = 'P0001', HINT = 'SF_INVALID_TRANSITION';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sf_messaging.participant p
     WHERE p.tenant_id = NEW.tenant_id AND p.thread_id = NEW.thread_id
       AND p.actor_id = NEW.actor_id AND p.removed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'actor is not an active participant'
      USING ERRCODE = 'P0001', HINT = 'SF_NOT_PARTICIPANT';
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION sf_messaging.enforce_read_receipt() OWNER TO sf_migrator;
REVOKE ALL ON FUNCTION sf_messaging.enforce_read_receipt() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_messaging.enforce_read_receipt() TO sf_cmp026_rw;

CREATE TRIGGER read_receipt_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sf_messaging.read_receipt
  FOR EACH ROW EXECUTE FUNCTION sf_messaging.enforce_read_receipt();

GRANT SELECT, INSERT ON sf_messaging.thread TO sf_cmp026_rw;
GRANT UPDATE (status, aggregate_version, message_seq, updated_at, last_correlation_id)
  ON sf_messaging.thread TO sf_cmp026_rw;
GRANT SELECT, INSERT ON sf_messaging.thread_transition TO sf_cmp026_rw;
GRANT SELECT, INSERT ON sf_messaging.participant TO sf_cmp026_rw;
GRANT UPDATE (removed_at, removed_by) ON sf_messaging.participant TO sf_cmp026_rw;
GRANT SELECT, INSERT ON sf_messaging.message TO sf_cmp026_rw;
GRANT SELECT, INSERT ON sf_messaging.message_attachment TO sf_cmp026_rw;
GRANT SELECT, INSERT ON sf_messaging.message_retraction TO sf_cmp026_rw;
GRANT SELECT, INSERT ON sf_messaging.notice_acknowledgement TO sf_cmp026_rw;
GRANT SELECT, INSERT ON sf_messaging.read_receipt TO sf_cmp026_rw;
GRANT UPDATE (last_read_sequence, read_at) ON sf_messaging.read_receipt TO sf_cmp026_rw;
GRANT SELECT, INSERT, DELETE, UPDATE (
  status, response_ref, response_status, response_body
) ON sf_messaging.idempotency_record TO sf_cmp026_rw;

REVOKE ALL ON sf_messaging.thread FROM PUBLIC;
REVOKE ALL ON sf_messaging.thread_transition FROM PUBLIC;
REVOKE ALL ON sf_messaging.participant FROM PUBLIC;
REVOKE ALL ON sf_messaging.message FROM PUBLIC;
REVOKE ALL ON sf_messaging.message_attachment FROM PUBLIC;
REVOKE ALL ON sf_messaging.message_retraction FROM PUBLIC;
REVOKE ALL ON sf_messaging.notice_acknowledgement FROM PUBLIC;
REVOKE ALL ON sf_messaging.read_receipt FROM PUBLIC;
REVOKE ALL ON sf_messaging.idempotency_record FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS read_receipt_guard ON sf_messaging.read_receipt;
DROP TRIGGER IF EXISTS notice_acknowledgement_guard ON sf_messaging.notice_acknowledgement;
DROP TRIGGER IF EXISTS message_retraction_guard ON sf_messaging.message_retraction;
DROP TRIGGER IF EXISTS message_insert_guard ON sf_messaging.message;
DROP TRIGGER IF EXISTS participant_guard ON sf_messaging.participant;
DROP TRIGGER IF EXISTS notice_acknowledgement_immutable ON sf_messaging.notice_acknowledgement;
DROP TRIGGER IF EXISTS message_retraction_immutable ON sf_messaging.message_retraction;
DROP TRIGGER IF EXISTS message_attachment_immutable ON sf_messaging.message_attachment;
DROP TRIGGER IF EXISTS message_immutable ON sf_messaging.message;
DROP TRIGGER IF EXISTS thread_transition_immutable ON sf_messaging.thread_transition;
DROP TRIGGER IF EXISTS thread_guard ON sf_messaging.thread;
DROP FUNCTION IF EXISTS sf_messaging.enforce_read_receipt();
DROP FUNCTION IF EXISTS sf_messaging.enforce_ack_insert();
DROP FUNCTION IF EXISTS sf_messaging.enforce_retraction_insert();
DROP FUNCTION IF EXISTS sf_messaging.enforce_message_insert();
DROP FUNCTION IF EXISTS sf_messaging.enforce_participant();
DROP FUNCTION IF EXISTS sf_messaging.prevent_mutation();
DROP FUNCTION IF EXISTS sf_messaging.enforce_thread();
DROP TABLE IF EXISTS sf_messaging.idempotency_record;
DROP TABLE IF EXISTS sf_messaging.read_receipt;
DROP TABLE IF EXISTS sf_messaging.notice_acknowledgement;
DROP TABLE IF EXISTS sf_messaging.message_retraction;
DROP TABLE IF EXISTS sf_messaging.message_attachment;
DROP TABLE IF EXISTS sf_messaging.message;
DROP TABLE IF EXISTS sf_messaging.participant;
DROP TABLE IF EXISTS sf_messaging.thread_transition;
DROP TABLE IF EXISTS sf_messaging.thread;
DROP SCHEMA IF EXISTS sf_messaging;
-- Role sf_cmp026_rw retained (may be referenced by runtime logins); never DROP ROLE here.
