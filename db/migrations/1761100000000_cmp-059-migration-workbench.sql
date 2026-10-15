-- CMP-059 Migration & Legacy Onboarding Workbench (SF-M09-004).
-- ADR-0006 Option A: sf_cmp059_rw NOLOGIN holds DML; FORCE RLS; PUBLIC revoked.
-- Architecture Constitution §39:
--   mapping version, dry-run, exception list and reconciliation evidence required
--   before cutover certification. dry_run_required_before_execute = true.
-- NO cutover statute is embedded: periods/thresholds are owner-supplied opaque refs.
-- Lifecycle aligns to FROZEN SF-CON-MIGRATION-PROJECT:
--   CREATED | PROFILED | MAPPED | DRY_RUN | EXECUTED | RECONCILED | FAILED | ROLLED_BACK
-- INT-017: Legacy migration and onboarding factory.
-- INT-011: Tenant isolation enforcement chain (RLS FORCE, sf_app runtime role).
--
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp059_rw') THEN
    CREATE ROLE sf_cmp059_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp059_rw IS
  'ADR-0006: CMP-059 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_migration AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_migration IS
  'isolation_class=TENANT_SCOPED; owner=CMP-059; Migration & Legacy Onboarding Workbench';

REVOKE ALL ON SCHEMA sf_migration FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_migration TO sf_cmp059_rw;
GRANT USAGE ON SCHEMA sf_migration TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_migration REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_migration REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_migration REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- ── migration_project ─────────────────────────────────────────────────────────
-- sf:isolation sf_migration.migration_project TENANT_SCOPED owner=CMP-059
CREATE TABLE sf_migration.migration_project (
  tenant_id              uuid        NOT NULL,
  project_id             uuid        NOT NULL,
  project_version        bigint      NOT NULL DEFAULT 1 CHECK (project_version >= 1),
  display_name           text        NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 200),
  source_system_ref      text        NOT NULL CHECK (source_system_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  target_service_code    text        CHECK (target_service_code IS NULL OR target_service_code ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'),
  lifecycle_status       text        NOT NULL DEFAULT 'CREATED'
                                      CHECK (lifecycle_status IN (
                                        'CREATED','PROFILED','MAPPED','DRY_RUN',
                                        'EXECUTED','RECONCILED','FAILED','ROLLED_BACK'
                                      )),
  dry_run_required_before_execute boolean NOT NULL DEFAULT true
                                      CHECK (dry_run_required_before_execute = true),
  dry_run_count          integer     NOT NULL DEFAULT 0 CHECK (dry_run_count >= 0),
  last_dry_run_at        timestamptz,
  mapping_spec_ref       text        CHECK (mapping_spec_ref IS NULL OR char_length(mapping_spec_ref) BETWEEN 1 AND 128),
  source_profile_ref     text        CHECK (source_profile_ref IS NULL OR char_length(source_profile_ref) BETWEEN 1 AND 128),
  idempotency_key        text        NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  correlation_id         uuid        NOT NULL,
  invented_statutory_policy_forbidden boolean NOT NULL DEFAULT true
                                      CHECK (invented_statutory_policy_forbidden = true),
  created_by             uuid        NOT NULL,
  created_at             timestamptz NOT NULL,
  updated_at             timestamptz NOT NULL,
  CONSTRAINT migration_project_pk PRIMARY KEY (tenant_id, project_id),
  CONSTRAINT migration_project_idem UNIQUE (tenant_id, idempotency_key)
);
ALTER TABLE sf_migration.migration_project ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_migration.migration_project FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_project_tenant ON sf_migration.migration_project
  USING (tenant_id = current_setting('sf.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON TABLE sf_migration.migration_project TO sf_cmp059_rw;
GRANT SELECT ON TABLE sf_migration.migration_project TO sf_app;

-- ── source_profile ────────────────────────────────────────────────────────────
-- sf:isolation sf_migration.source_profile TENANT_SCOPED owner=CMP-059
CREATE TABLE sf_migration.source_profile (
  tenant_id              uuid        NOT NULL,
  profile_id             uuid        NOT NULL,
  project_id             uuid        NOT NULL,
  profile_version        bigint      NOT NULL DEFAULT 1 CHECK (profile_version >= 1),
  schema_descriptor      jsonb       NOT NULL CHECK (jsonb_typeof(schema_descriptor) = 'object'),
  field_count            integer     NOT NULL CHECK (field_count >= 0),
  record_count_estimate  bigint      CHECK (record_count_estimate IS NULL OR record_count_estimate >= 0),
  created_by             uuid        NOT NULL,
  created_at             timestamptz NOT NULL,
  CONSTRAINT source_profile_pk PRIMARY KEY (tenant_id, profile_id),
  CONSTRAINT source_profile_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES sf_migration.migration_project (tenant_id, project_id)
);
ALTER TABLE sf_migration.source_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_migration.source_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY source_profile_tenant ON sf_migration.source_profile
  USING (tenant_id = current_setting('sf.tenant_id', true)::uuid);

GRANT SELECT, INSERT ON TABLE sf_migration.source_profile TO sf_cmp059_rw;
GRANT SELECT ON TABLE sf_migration.source_profile TO sf_app;

-- ── mapping_spec ──────────────────────────────────────────────────────────────
-- sf:isolation sf_migration.mapping_spec TENANT_SCOPED owner=CMP-059
CREATE TABLE sf_migration.mapping_spec (
  tenant_id              uuid        NOT NULL,
  mapping_id             uuid        NOT NULL,
  project_id             uuid        NOT NULL,
  mapping_version_ref    text        NOT NULL CHECK (mapping_version_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  field_mappings         jsonb       NOT NULL CHECK (jsonb_typeof(field_mappings) = 'array'),
  exception_policy_ref   text        CHECK (exception_policy_ref IS NULL OR exception_policy_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  created_by             uuid        NOT NULL,
  created_at             timestamptz NOT NULL,
  CONSTRAINT mapping_spec_pk PRIMARY KEY (tenant_id, mapping_id),
  CONSTRAINT mapping_spec_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES sf_migration.migration_project (tenant_id, project_id)
);
ALTER TABLE sf_migration.mapping_spec ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_migration.mapping_spec FORCE ROW LEVEL SECURITY;
CREATE POLICY mapping_spec_tenant ON sf_migration.mapping_spec
  USING (tenant_id = current_setting('sf.tenant_id', true)::uuid);

GRANT SELECT, INSERT ON TABLE sf_migration.mapping_spec TO sf_cmp059_rw;
GRANT SELECT ON TABLE sf_migration.mapping_spec TO sf_app;

-- ── migration_batch ───────────────────────────────────────────────────────────
-- sf:isolation sf_migration.migration_batch TENANT_SCOPED owner=CMP-059
CREATE TABLE sf_migration.migration_batch (
  tenant_id              uuid        NOT NULL,
  batch_id               uuid        NOT NULL,
  project_id             uuid        NOT NULL,
  batch_type             text        NOT NULL CHECK (batch_type IN ('DRY_RUN','EXECUTE')),
  status                 text        NOT NULL DEFAULT 'PENDING'
                                      CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED','ROLLED_BACK')),
  mapping_id             uuid        NOT NULL,
  total_records          bigint      NOT NULL DEFAULT 0 CHECK (total_records >= 0),
  processed_records      bigint      NOT NULL DEFAULT 0 CHECK (processed_records >= 0),
  failed_records         bigint      NOT NULL DEFAULT 0 CHECK (failed_records >= 0),
  exception_count        integer     NOT NULL DEFAULT 0 CHECK (exception_count >= 0),
  started_at             timestamptz,
  completed_at           timestamptz,
  created_by             uuid        NOT NULL,
  created_at             timestamptz NOT NULL,
  CONSTRAINT migration_batch_pk PRIMARY KEY (tenant_id, batch_id),
  CONSTRAINT migration_batch_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES sf_migration.migration_project (tenant_id, project_id),
  CONSTRAINT migration_batch_mapping_fk FOREIGN KEY (tenant_id, mapping_id)
    REFERENCES sf_migration.mapping_spec (tenant_id, mapping_id)
);
ALTER TABLE sf_migration.migration_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_migration.migration_batch FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_batch_tenant ON sf_migration.migration_batch
  USING (tenant_id = current_setting('sf.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON TABLE sf_migration.migration_batch TO sf_cmp059_rw;
GRANT SELECT ON TABLE sf_migration.migration_batch TO sf_app;

-- ── reconciliation_result ─────────────────────────────────────────────────────
-- sf:isolation sf_migration.reconciliation_result TENANT_SCOPED owner=CMP-059
CREATE TABLE sf_migration.reconciliation_result (
  tenant_id              uuid        NOT NULL,
  result_id              uuid        NOT NULL,
  project_id             uuid        NOT NULL,
  batch_id               uuid        NOT NULL,
  source_count           bigint      NOT NULL CHECK (source_count >= 0),
  target_count           bigint      NOT NULL CHECK (target_count >= 0),
  matched_count          bigint      NOT NULL DEFAULT 0 CHECK (matched_count >= 0),
  exception_list         jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(exception_list) = 'array'),
  reconciliation_status  text        NOT NULL CHECK (reconciliation_status IN ('PASSED','FAILED','PARTIAL')),
  evidence_ref           text        CHECK (evidence_ref IS NULL OR evidence_ref ~ '^[A-Za-z0-9][A-Za-z0-9_./:+-]{0,255}$'),
  created_by             uuid        NOT NULL,
  created_at             timestamptz NOT NULL,
  CONSTRAINT reconciliation_result_pk PRIMARY KEY (tenant_id, result_id),
  CONSTRAINT reconciliation_result_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES sf_migration.migration_project (tenant_id, project_id),
  CONSTRAINT reconciliation_result_batch_fk FOREIGN KEY (tenant_id, batch_id)
    REFERENCES sf_migration.migration_batch (tenant_id, batch_id)
);
ALTER TABLE sf_migration.reconciliation_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_migration.reconciliation_result FORCE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_result_tenant ON sf_migration.reconciliation_result
  USING (tenant_id = current_setting('sf.tenant_id', true)::uuid);

GRANT SELECT, INSERT ON TABLE sf_migration.reconciliation_result TO sf_cmp059_rw;
GRANT SELECT ON TABLE sf_migration.reconciliation_result TO sf_app;

-- ── cutover_manifest ──────────────────────────────────────────────────────────
-- sf:isolation sf_migration.cutover_manifest TENANT_SCOPED owner=CMP-059
-- Cutover requires dry-run evidence + reconciliation PASSED + maker-checker approval.
-- No statutory cutover period; owner_supplied_cutover_ref is opaque.
CREATE TABLE sf_migration.cutover_manifest (
  tenant_id              uuid        NOT NULL,
  manifest_id            uuid        NOT NULL,
  project_id             uuid        NOT NULL,
  dry_run_batch_id       uuid        NOT NULL,
  execute_batch_id       uuid,
  owner_supplied_cutover_ref text    CHECK (owner_supplied_cutover_ref IS NULL OR owner_supplied_cutover_ref ~ '^[A-Za-z0-9][A-Za-z0-9_./:+-]{0,255}$'),
  approval_ref           text        CHECK (approval_ref IS NULL OR approval_ref ~ '^[A-Za-z0-9][A-Za-z0-9_./:+-]{0,255}$'),
  status                 text        NOT NULL DEFAULT 'PENDING_APPROVAL'
                                      CHECK (status IN ('PENDING_APPROVAL','APPROVED','APPLIED','ROLLED_BACK')),
  created_by             uuid        NOT NULL,
  approved_by            uuid,
  created_at             timestamptz NOT NULL,
  approved_at            timestamptz,
  CONSTRAINT cutover_manifest_pk PRIMARY KEY (tenant_id, manifest_id),
  CONSTRAINT cutover_manifest_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES sf_migration.migration_project (tenant_id, project_id),
  CONSTRAINT cutover_manifest_dry_run_fk FOREIGN KEY (tenant_id, dry_run_batch_id)
    REFERENCES sf_migration.migration_batch (tenant_id, batch_id)
);
ALTER TABLE sf_migration.cutover_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_migration.cutover_manifest FORCE ROW LEVEL SECURITY;
CREATE POLICY cutover_manifest_tenant ON sf_migration.cutover_manifest
  USING (tenant_id = current_setting('sf.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON TABLE sf_migration.cutover_manifest TO sf_cmp059_rw;
GRANT SELECT ON TABLE sf_migration.cutover_manifest TO sf_app;

-- ── idempotency_record ────────────────────────────────────────────────────────
-- sf:isolation sf_migration.idempotency_record TENANT_SCOPED owner=CMP-059
CREATE TABLE sf_migration.idempotency_record (
  tenant_id              uuid        NOT NULL,
  principal_id           uuid        NOT NULL,
  endpoint               text        NOT NULL CHECK (char_length(endpoint) BETWEEN 1 AND 128),
  idempotency_key        text        NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  request_fingerprint    text        NOT NULL CHECK (char_length(request_fingerprint) BETWEEN 8 AND 128),
  status                 text        NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  response_status        integer,
  response_body          jsonb,
  created_at             timestamptz NOT NULL,
  expires_at             timestamptz NOT NULL,
  CONSTRAINT idempotency_record_pk PRIMARY KEY (tenant_id, principal_id, endpoint, idempotency_key)
);
ALTER TABLE sf_migration.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_migration.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_tenant ON sf_migration.idempotency_record
  USING (tenant_id = current_setting('sf.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON TABLE sf_migration.idempotency_record TO sf_cmp059_rw;
GRANT SELECT ON TABLE sf_migration.idempotency_record TO sf_app;

-- ── outbox_event (transactional outbox) ───────────────────────────────────────
-- sf:isolation sf_migration.outbox_event PLATFORM_OPERATIONAL owner=CMP-059
CREATE TABLE sf_migration.outbox_event (
  event_id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL,
  topic                  text        NOT NULL CHECK (topic ~ '^[a-z][a-z0-9._-]{1,127}$'),
  event_type             text        NOT NULL CHECK (event_type ~ '^[A-Z][A-Za-z0-9]{1,63}$'),
  payload                jsonb       NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  trace_id               text,
  correlation_id         text,
  published              boolean     NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_event_pk PRIMARY KEY (event_id)
);
CREATE INDEX outbox_event_unpublished ON sf_migration.outbox_event (created_at)
  WHERE NOT published;

GRANT SELECT, INSERT, UPDATE ON TABLE sf_migration.outbox_event TO sf_cmp059_rw;
GRANT SELECT ON TABLE sf_migration.outbox_event TO sf_app;

-- Down Migration
REVOKE ALL ON SCHEMA sf_migration FROM sf_cmp059_rw;
REVOKE ALL ON SCHEMA sf_migration FROM sf_app;
DROP SCHEMA IF EXISTS sf_migration CASCADE;
-- Role sf_cmp059_rw retained (may be referenced by runtime logins); never DROP ROLE here.
