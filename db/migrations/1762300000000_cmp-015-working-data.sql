-- CMP-015 application working data (CCR-M10-001). AWS v1.7 CMP-015: system of record for citizen
-- applications with mutable working data separated from immutable decision artifacts. One row per
-- application, optimistic revision, FORCE RLS, DML only through sf_cmp015_rw (ADR-0006).
-- pii=CITIZEN_SUPPLIED: field values live only here; events and audit carry data_hash/revision.
--
-- Up Migration

-- sf:isolation sf_application_case.application_working_data TENANT_SCOPED owner=CMP-015
CREATE TABLE sf_application_case.application_working_data (
  tenant_id uuid NOT NULL,
  application_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 1),
  form_version_id uuid NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 65536),
  data_hash text NOT NULL CHECK (data_hash ~ '^sha256:[0-9a-f]{64}$'),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  last_correlation_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, application_id),
  FOREIGN KEY (tenant_id, application_id)
    REFERENCES sf_application_case.application_case (tenant_id, application_id)
);
COMMENT ON TABLE sf_application_case.application_working_data IS
  'isolation_class=TENANT_SCOPED; owner=CMP-015; pii=CITIZEN_SUPPLIED; CCR-M10-001';
ALTER TABLE sf_application_case.application_working_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_application_case.application_working_data FORCE ROW LEVEL SECURITY;
CREATE POLICY application_working_data_tenant ON sf_application_case.application_working_data TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_application_case.application_working_data OWNER TO sf_migrator;

REVOKE ALL ON sf_application_case.application_working_data FROM PUBLIC;
GRANT SELECT, INSERT ON sf_application_case.application_working_data TO sf_cmp015_rw;
GRANT UPDATE (revision, form_version_id, data, data_hash, updated_by, updated_at, last_correlation_id)
  ON sf_application_case.application_working_data TO sf_cmp015_rw;

CREATE INDEX application_case_tenant_created_idx
  ON sf_application_case.application_case (tenant_id, created_at DESC);

-- Down Migration
DROP INDEX IF EXISTS sf_application_case.application_case_tenant_created_idx;
DROP TABLE IF EXISTS sf_application_case.application_working_data;
