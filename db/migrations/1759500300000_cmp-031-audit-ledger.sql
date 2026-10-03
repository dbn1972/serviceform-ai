-- CMP-031 Audit & Evidence Ledger (sf_audit). ADR-0006 Option A: sf_cmp031_rw NOLOGIN
-- holds DML; sf_app has no generic DML/SELECT on authoritative ledger tables; FORCE RLS;
-- PUBLIC revoked; runtime is not table owner (sf_migrator).
-- PostgreSQL has no CREATE ROLE IF NOT EXISTS; shared sf_migrator is created once via pg_roles.
--
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp031_rw') THEN
    CREATE ROLE sf_cmp031_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp031_rw IS
  'ADR-0006: CMP-031 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_audit AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_audit IS 'isolation_class=mixed; owner=CMP-031; audit ledger';
REVOKE ALL ON SCHEMA sf_audit FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_audit TO sf_app;
GRANT USAGE ON SCHEMA sf_audit TO sf_cmp031_rw;
REVOKE CREATE ON SCHEMA sf_audit FROM sf_app, sf_cmp031_rw, PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_audit REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_audit REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_audit REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

CREATE FUNCTION sf_audit.reject_mutation() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
BEGIN
  RAISE EXCEPTION 'audit ledger is append-only' USING ERRCODE = 'P0001';
END;
$$;

CREATE FUNCTION sf_audit.enforce_tenant_head() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.last_seq <> 0 OR octet_length(NEW.last_hash) <> 32 THEN
      RAISE EXCEPTION 'audit chain head genesis must be seq 0' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.last_seq <> OLD.last_seq + 1 THEN
    RAISE EXCEPTION 'audit chain head seq must advance by 1' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.last_recorded_at < OLD.last_recorded_at THEN
    RAISE EXCEPTION 'audit chain head recorded_at must be monotonic' USING ERRCODE = 'P0001';
  END IF;
  IF octet_length(NEW.last_hash) <> 32 THEN
    RAISE EXCEPTION 'audit chain head hash length' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sf_audit.audit_event_key k
    WHERE k.tenant_id = NEW.tenant_id
      AND k.chain_seq = NEW.last_seq
      AND k.content_hash IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'audit chain head hash linkage missing key row' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sf_audit.audit_event e
    WHERE e.tenant_id = NEW.tenant_id
      AND e.chain_seq = NEW.last_seq
      AND e.row_hash = NEW.last_hash
  ) THEN
    RAISE EXCEPTION 'audit chain head hash linkage missing ledger row' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION sf_audit.enforce_platform_head() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.id <> 1 OR NEW.last_seq <> 0 OR octet_length(NEW.last_hash) <> 32 THEN
      RAISE EXCEPTION 'platform audit head genesis invalid' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.last_seq <> OLD.last_seq + 1 THEN
    RAISE EXCEPTION 'audit chain head seq must advance by 1' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.last_recorded_at < OLD.last_recorded_at THEN
    RAISE EXCEPTION 'audit chain head recorded_at must be monotonic' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sf_audit.audit_event_platform e
    WHERE e.chain_seq = NEW.last_seq AND e.row_hash = NEW.last_hash
  ) THEN
    RAISE EXCEPTION 'platform audit chain head hash linkage missing ledger row' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

-- sf:isolation sf_audit.audit_event TENANT_SCOPED owner=CMP-031
CREATE TABLE sf_audit.audit_event (
  tenant_id uuid NOT NULL,
  chain_seq bigint NOT NULL CHECK (chain_seq >= 1),
  recorded_at timestamptz NOT NULL,
  audit_id uuid NOT NULL,
  record jsonb NOT NULL CHECK (octet_length(record::text) <= 262144),
  prev_hash bytea NOT NULL CHECK (octet_length(prev_hash) = 32),
  row_hash bytea NOT NULL CHECK (octet_length(row_hash) = 32),
  CHECK (record ->> 'audit_id' = audit_id::text),
  CHECK (record ->> 'tenant_id' = tenant_id::text),
  PRIMARY KEY (tenant_id, chain_seq, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE INDEX audit_event_recorded_idx ON sf_audit.audit_event (tenant_id, recorded_at, chain_seq);
CREATE INDEX audit_event_resource_idx ON sf_audit.audit_event (tenant_id, (record->>'resource_type'), (record->>'resource_id'), recorded_at);
CREATE INDEX audit_event_corr_idx ON sf_audit.audit_event (tenant_id, (record->>'correlation_id'));
CREATE INDEX audit_event_actor_idx ON sf_audit.audit_event (tenant_id, (record->>'actor_id'), recorded_at);

ALTER TABLE sf_audit.audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_audit.audit_event FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_event_select ON sf_audit.audit_event FOR SELECT TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id());
CREATE POLICY audit_event_insert ON sf_audit.audit_event FOR INSERT TO sf_app
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
CREATE TRIGGER audit_event_no_mutate BEFORE UPDATE OR DELETE ON sf_audit.audit_event
  FOR EACH ROW EXECUTE FUNCTION sf_audit.reject_mutation();
-- sf:allow-destructive ADR-0006
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON sf_audit.audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION sf_audit.reject_mutation();
GRANT SELECT, INSERT ON sf_audit.audit_event TO sf_cmp031_rw;
REVOKE ALL ON sf_audit.audit_event FROM PUBLIC;

-- sf:isolation sf_audit.audit_event_key TENANT_SCOPED owner=CMP-031
CREATE TABLE sf_audit.audit_event_key (
  tenant_id uuid NOT NULL,
  audit_id uuid NOT NULL,
  chain_seq bigint NOT NULL,
  recorded_at timestamptz NOT NULL,
  content_hash bytea NOT NULL CHECK (octet_length(content_hash) = 32),
  PRIMARY KEY (tenant_id, audit_id),
  UNIQUE (tenant_id, chain_seq)
);
ALTER TABLE sf_audit.audit_event_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_audit.audit_event_key FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_event_key_select ON sf_audit.audit_event_key FOR SELECT TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id());
CREATE POLICY audit_event_key_insert ON sf_audit.audit_event_key FOR INSERT TO sf_app
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
CREATE TRIGGER audit_event_key_no_mutate BEFORE UPDATE OR DELETE ON sf_audit.audit_event_key
  FOR EACH ROW EXECUTE FUNCTION sf_audit.reject_mutation();
-- sf:allow-destructive ADR-0006
CREATE TRIGGER audit_event_key_no_truncate BEFORE TRUNCATE ON sf_audit.audit_event_key
  FOR EACH STATEMENT EXECUTE FUNCTION sf_audit.reject_mutation();
GRANT SELECT, INSERT ON sf_audit.audit_event_key TO sf_cmp031_rw;
REVOKE ALL ON sf_audit.audit_event_key FROM PUBLIC;

-- sf:isolation sf_audit.audit_chain_head TENANT_SCOPED owner=CMP-031
CREATE TABLE sf_audit.audit_chain_head (
  tenant_id uuid NOT NULL PRIMARY KEY,
  last_seq bigint NOT NULL CHECK (last_seq >= 0),
  last_hash bytea NOT NULL CHECK (octet_length(last_hash) = 32),
  last_recorded_at timestamptz NOT NULL
);
ALTER TABLE sf_audit.audit_chain_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_audit.audit_chain_head FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_chain_head_all ON sf_audit.audit_chain_head TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
CREATE TRIGGER audit_chain_head_enforce BEFORE INSERT OR UPDATE ON sf_audit.audit_chain_head
  FOR EACH ROW EXECUTE FUNCTION sf_audit.enforce_tenant_head();
CREATE TRIGGER audit_chain_head_no_delete BEFORE DELETE ON sf_audit.audit_chain_head
  FOR EACH ROW EXECUTE FUNCTION sf_audit.reject_mutation();
-- sf:allow-destructive ADR-0006
CREATE TRIGGER audit_chain_head_no_truncate BEFORE TRUNCATE ON sf_audit.audit_chain_head
  FOR EACH STATEMENT EXECUTE FUNCTION sf_audit.reject_mutation();
GRANT SELECT, INSERT ON sf_audit.audit_chain_head TO sf_cmp031_rw;
GRANT UPDATE (last_seq, last_hash, last_recorded_at) ON sf_audit.audit_chain_head TO sf_cmp031_rw;
REVOKE ALL ON sf_audit.audit_chain_head FROM PUBLIC;

-- sf:isolation sf_audit.audit_event_platform PLATFORM_OPERATIONAL owner=CMP-031
CREATE TABLE sf_audit.audit_event_platform (
  chain_seq bigint NOT NULL CHECK (chain_seq >= 1),
  recorded_at timestamptz NOT NULL,
  audit_id uuid NOT NULL,
  record jsonb NOT NULL CHECK (octet_length(record::text) <= 262144),
  prev_hash bytea NOT NULL CHECK (octet_length(prev_hash) = 32),
  row_hash bytea NOT NULL CHECK (octet_length(row_hash) = 32),
  CHECK (record ->> 'audit_id' = audit_id::text),
  CHECK (jsonb_typeof(record -> 'tenant_id') = 'null'),
  PRIMARY KEY (chain_seq, recorded_at)
) PARTITION BY RANGE (recorded_at);
ALTER TABLE sf_audit.audit_event_platform ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_audit.audit_event_platform FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_event_platform_insert ON sf_audit.audit_event_platform FOR INSERT TO sf_app
  WITH CHECK (sf_platform.current_tenant_id() IS NULL);
CREATE POLICY audit_event_platform_select ON sf_audit.audit_event_platform FOR SELECT TO sf_app
  USING (sf_platform.current_tenant_id() IS NULL);
CREATE TRIGGER audit_event_platform_no_mutate BEFORE UPDATE OR DELETE ON sf_audit.audit_event_platform
  FOR EACH ROW EXECUTE FUNCTION sf_audit.reject_mutation();
-- sf:allow-destructive ADR-0006
CREATE TRIGGER audit_event_platform_no_truncate BEFORE TRUNCATE ON sf_audit.audit_event_platform
  FOR EACH STATEMENT EXECUTE FUNCTION sf_audit.reject_mutation();
GRANT SELECT, INSERT ON sf_audit.audit_event_platform TO sf_cmp031_rw;
REVOKE ALL ON sf_audit.audit_event_platform FROM PUBLIC;

-- sf:isolation sf_audit.audit_event_platform_key PLATFORM_OPERATIONAL owner=CMP-031
CREATE TABLE sf_audit.audit_event_platform_key (
  audit_id uuid PRIMARY KEY,
  chain_seq bigint NOT NULL UNIQUE,
  recorded_at timestamptz NOT NULL,
  content_hash bytea NOT NULL CHECK (octet_length(content_hash) = 32)
);
ALTER TABLE sf_audit.audit_event_platform_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_audit.audit_event_platform_key FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_event_platform_key_insert ON sf_audit.audit_event_platform_key FOR INSERT TO sf_app
  WITH CHECK (sf_platform.current_tenant_id() IS NULL);
CREATE POLICY audit_event_platform_key_select ON sf_audit.audit_event_platform_key FOR SELECT TO sf_app
  USING (sf_platform.current_tenant_id() IS NULL);
CREATE TRIGGER audit_event_platform_key_no_mutate BEFORE UPDATE OR DELETE ON sf_audit.audit_event_platform_key
  FOR EACH ROW EXECUTE FUNCTION sf_audit.reject_mutation();
GRANT SELECT, INSERT ON sf_audit.audit_event_platform_key TO sf_cmp031_rw;
REVOKE ALL ON sf_audit.audit_event_platform_key FROM PUBLIC;

-- sf:isolation sf_audit.audit_chain_head_platform PLATFORM_OPERATIONAL owner=CMP-031
CREATE TABLE sf_audit.audit_chain_head_platform (
  id smallint PRIMARY KEY CHECK (id = 1),
  last_seq bigint NOT NULL CHECK (last_seq >= 0),
  last_hash bytea NOT NULL CHECK (octet_length(last_hash) = 32),
  last_recorded_at timestamptz NOT NULL
);
ALTER TABLE sf_audit.audit_chain_head_platform ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_audit.audit_chain_head_platform FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_chain_head_platform_write ON sf_audit.audit_chain_head_platform FOR INSERT TO sf_app
  WITH CHECK (sf_platform.current_tenant_id() IS NULL);
CREATE POLICY audit_chain_head_platform_select ON sf_audit.audit_chain_head_platform FOR SELECT TO sf_app
  USING (sf_platform.current_tenant_id() IS NULL);
CREATE POLICY audit_chain_head_platform_update ON sf_audit.audit_chain_head_platform FOR UPDATE TO sf_app
  USING (sf_platform.current_tenant_id() IS NULL)
  WITH CHECK (sf_platform.current_tenant_id() IS NULL);
CREATE TRIGGER audit_chain_head_platform_enforce BEFORE INSERT OR UPDATE ON sf_audit.audit_chain_head_platform
  FOR EACH ROW EXECUTE FUNCTION sf_audit.enforce_platform_head();
CREATE TRIGGER audit_chain_head_platform_no_delete BEFORE DELETE ON sf_audit.audit_chain_head_platform
  FOR EACH ROW EXECUTE FUNCTION sf_audit.reject_mutation();
GRANT SELECT, INSERT ON sf_audit.audit_chain_head_platform TO sf_cmp031_rw;
GRANT UPDATE (last_seq, last_hash, last_recorded_at) ON sf_audit.audit_chain_head_platform TO sf_cmp031_rw;
REVOKE ALL ON sf_audit.audit_chain_head_platform FROM PUBLIC;

CREATE FUNCTION sf_audit.create_month_partitions(from_date date, months integer) RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
DECLARE
  i integer;
  start_ts timestamptz;
  end_ts timestamptz;
  part_name text;
  plat_name text;
BEGIN
  IF months < 1 OR months > 120 THEN
    RAISE EXCEPTION 'invalid partition month count';
  END IF;
  FOR i IN 0 .. months - 1 LOOP
    start_ts := timezone('UTC', date_trunc('month', from_date::timestamp) + make_interval(months => i));
    end_ts := timezone('UTC', date_trunc('month', from_date::timestamp) + make_interval(months => i + 1));
    part_name := format('audit_event_y%sm%s', to_char(start_ts, 'YYYY'), to_char(start_ts, 'MM'));
    plat_name := format('audit_event_platform_y%sm%s', to_char(start_ts, 'YYYY'), to_char(start_ts, 'MM'));
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS sf_audit.%I PARTITION OF sf_audit.audit_event FOR VALUES FROM (%L) TO (%L)',
      part_name, start_ts, end_ts);
    EXECUTE format('ALTER TABLE sf_audit.%I ENABLE ROW LEVEL SECURITY', part_name);
    EXECUTE format('ALTER TABLE sf_audit.%I FORCE ROW LEVEL SECURITY', part_name);
    EXECUTE format('GRANT SELECT, INSERT ON sf_audit.%I TO sf_cmp031_rw', part_name);
    EXECUTE format('REVOKE ALL ON sf_audit.%I FROM PUBLIC', part_name);
    EXECUTE format(
      'DROP TRIGGER IF EXISTS audit_event_part_no_mutate ON sf_audit.%I',
      part_name);
    EXECUTE format(
      'CREATE TRIGGER audit_event_part_no_mutate BEFORE UPDATE OR DELETE ON sf_audit.%I FOR EACH ROW EXECUTE FUNCTION sf_audit.reject_mutation()',
      part_name);
    EXECUTE format(
      'DROP TRIGGER IF EXISTS audit_event_part_no_truncate ON sf_audit.%I',
      part_name);
    EXECUTE format(
      -- sf:allow-destructive ADR-0006
      'CREATE TRIGGER audit_event_part_no_truncate BEFORE TRUNCATE ON sf_audit.%I FOR EACH STATEMENT EXECUTE FUNCTION sf_audit.reject_mutation()',
      part_name);
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS sf_audit.%I PARTITION OF sf_audit.audit_event_platform FOR VALUES FROM (%L) TO (%L)',
      plat_name, start_ts, end_ts);
    EXECUTE format('ALTER TABLE sf_audit.%I ENABLE ROW LEVEL SECURITY', plat_name);
    EXECUTE format('ALTER TABLE sf_audit.%I FORCE ROW LEVEL SECURITY', plat_name);
    EXECUTE format('GRANT SELECT, INSERT ON sf_audit.%I TO sf_cmp031_rw', plat_name);
    EXECUTE format('REVOKE ALL ON sf_audit.%I FROM PUBLIC', plat_name);
    EXECUTE format('ALTER TABLE sf_audit.%I OWNER TO sf_migrator', part_name);
    EXECUTE format('ALTER TABLE sf_audit.%I OWNER TO sf_migrator', plat_name);
    EXECUTE format(
      'DROP TRIGGER IF EXISTS audit_event_platform_part_no_mutate ON sf_audit.%I',
      plat_name);
    EXECUTE format(
      'CREATE TRIGGER audit_event_platform_part_no_mutate BEFORE UPDATE OR DELETE ON sf_audit.%I FOR EACH ROW EXECUTE FUNCTION sf_audit.reject_mutation()',
      plat_name);
    EXECUTE format(
      'DROP TRIGGER IF EXISTS audit_event_platform_part_no_truncate ON sf_audit.%I',
      plat_name);
    EXECUTE format(
      -- sf:allow-destructive ADR-0006
      'CREATE TRIGGER audit_event_platform_part_no_truncate BEFORE TRUNCATE ON sf_audit.%I FOR EACH STATEMENT EXECUTE FUNCTION sf_audit.reject_mutation()',
      plat_name);
  END LOOP;
END;
$$;

CREATE FUNCTION sf_audit.ensure_partitions() RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
BEGIN
  PERFORM sf_audit.create_month_partitions((timezone('UTC', now()))::date, 24);
END;
$$;

REVOKE ALL ON FUNCTION sf_audit.reject_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION sf_audit.enforce_tenant_head() FROM PUBLIC;
REVOKE ALL ON FUNCTION sf_audit.enforce_platform_head() FROM PUBLIC;
REVOKE ALL ON FUNCTION sf_audit.create_month_partitions(date, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION sf_audit.ensure_partitions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sf_audit.reject_mutation() TO sf_app;
GRANT EXECUTE ON FUNCTION sf_audit.enforce_tenant_head() TO sf_app;
GRANT EXECUTE ON FUNCTION sf_audit.enforce_platform_head() TO sf_app;

SELECT sf_audit.create_month_partitions(DATE '2026-10-01', 24);
SELECT sf_audit.ensure_partitions();

ALTER FUNCTION sf_audit.reject_mutation() OWNER TO sf_migrator;
ALTER FUNCTION sf_audit.enforce_tenant_head() OWNER TO sf_migrator;
ALTER FUNCTION sf_audit.enforce_platform_head() OWNER TO sf_migrator;
ALTER FUNCTION sf_audit.create_month_partitions(date, integer) OWNER TO sf_migrator;
ALTER FUNCTION sf_audit.ensure_partitions() OWNER TO sf_migrator;
ALTER TABLE sf_audit.audit_event OWNER TO sf_migrator;
ALTER TABLE sf_audit.audit_event_key OWNER TO sf_migrator;
ALTER TABLE sf_audit.audit_chain_head OWNER TO sf_migrator;
ALTER TABLE sf_audit.audit_event_platform OWNER TO sf_migrator;
ALTER TABLE sf_audit.audit_event_platform_key OWNER TO sf_migrator;
ALTER TABLE sf_audit.audit_chain_head_platform OWNER TO sf_migrator;

-- Superuser bypasses FORCE RLS to plant the platform genesis head (runtime cannot).
INSERT INTO sf_audit.audit_chain_head_platform (id, last_seq, last_hash, last_recorded_at)
VALUES (1, 0, decode(repeat('00', 32), 'hex'), TIMESTAMPTZ '1970-01-01 00:00:00+00');

-- Down Migration
DROP SCHEMA IF EXISTS sf_audit CASCADE;
DROP ROLE IF EXISTS sf_cmp031_rw;
