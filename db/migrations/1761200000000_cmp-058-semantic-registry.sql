-- CMP-058 Government Semantic & Data Dictionary Registry (SF-M09-003).
-- ADR-0006 Option A: sf_cmp058_rw NOLOGIN holds DML; FORCE RLS; PUBLIC revoked; runtime is not
-- the table owner (sf_migrator).
-- Semantic elements are platform-global canonical records: no tenant payload on the element itself.
-- Tenant-specific field bindings (studio metadata associating a form field to a semantic element)
-- ARE tenant-scoped and reside in sf_semantics.field_binding.
-- CMP-058 stores opaque semantic refs only. Government field meanings are NEVER invented here.
-- lifecycle: DRAFT -> PUBLISHED -> DEPRECATED. Published records are immutable (version-only).
-- INT-016: Studio and runtime bindings reference published element_ids by opaque ref.
-- INT-011: Tenant isolation chain enforced via FORCE RLS on all TENANT_SCOPED tables.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp058_rw') THEN
    CREATE ROLE sf_cmp058_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
COMMENT ON ROLE sf_cmp058_rw IS
  'ADR-0006: CMP-058 privilege role. NOLOGIN. Runtime logins inherit sf_app + this role only.';

CREATE SCHEMA sf_semantics AUTHORIZATION sf_migrator;
COMMENT ON SCHEMA sf_semantics IS
  'isolation_class=mixed; owner=CMP-058; semantic elements (GLOBAL), tenant field bindings (TENANT_SCOPED)';

REVOKE ALL ON SCHEMA sf_semantics FROM PUBLIC;
GRANT USAGE ON SCHEMA sf_semantics TO sf_cmp058_rw;
GRANT USAGE ON SCHEMA sf_semantics TO sf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_semantics REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_semantics REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sf_migrator IN SCHEMA sf_semantics REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA sf_platform TO sf_migrator;

-- sf:isolation sf_semantics.semantic_element GLOBAL owner=CMP-058
-- Platform-global canonical semantic element records. No tenant_id on the element.
-- Published versions are immutable: INSERT new version row, never UPDATE existing published rows.
CREATE TABLE sf_semantics.semantic_element (
  element_id   uuid        NOT NULL,
  version      integer     NOT NULL CHECK (version >= 1),
  element_code text        NOT NULL CHECK (element_code ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  lifecycle_status text    NOT NULL CHECK (lifecycle_status IN ('DRAFT', 'PUBLISHED', 'DEPRECATED')),
  privacy_classification text NOT NULL
    CHECK (privacy_classification IN ('PUBLIC', 'INTERNAL', 'PII', 'SENSITIVE_PII')),
  code_list_binding_ref text
    CHECK (code_list_binding_ref IS NULL OR code_list_binding_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  idempotency_key text     NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  correlation_id  uuid     NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  deprecated_at   timestamptz,
  PRIMARY KEY (element_id, version),
  -- code uniqueness per published version
  CONSTRAINT semantic_element_code_version_unique UNIQUE (element_code, version)
);
COMMENT ON TABLE sf_semantics.semantic_element IS
  'isolation_class=GLOBAL; published versions immutable; no tenant payload; opaque refs only';
CREATE INDEX semantic_element_code_idx ON sf_semantics.semantic_element (element_code);
CREATE INDEX semantic_element_status_idx ON sf_semantics.semantic_element (lifecycle_status);

-- Immutability trigger: once published a row cannot be mutated.
CREATE FUNCTION sf_semantics.enforce_published_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = sf_semantics, pg_temp
AS $$
BEGIN
  IF OLD.lifecycle_status = 'PUBLISHED' AND
     (NEW.element_code <> OLD.element_code OR
      NEW.privacy_classification <> OLD.privacy_classification OR
      NEW.code_list_binding_ref IS DISTINCT FROM OLD.code_list_binding_ref) THEN
    RAISE EXCEPTION 'Published semantic element is immutable (element_id=%, version=%)',
      OLD.element_id, OLD.version
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sf_semantics.enforce_published_immutable() OWNER TO sf_migrator;

CREATE TRIGGER semantic_element_immutable_tg
  BEFORE UPDATE ON sf_semantics.semantic_element
  FOR EACH ROW EXECUTE FUNCTION sf_semantics.enforce_published_immutable();

GRANT SELECT ON sf_semantics.semantic_element TO sf_app;
GRANT INSERT, UPDATE ON sf_semantics.semantic_element TO sf_cmp058_rw;
ALTER TABLE sf_semantics.semantic_element OWNER TO sf_migrator;

-- sf:isolation sf_semantics.field_binding TENANT_SCOPED owner=CMP-058
-- Studio-side binding: a form field within a tenant's offering is bound to a published semantic
-- element by opaque element_id ref. No government field meaning is stored or enforced here.
CREATE TABLE sf_semantics.field_binding (
  tenant_id        uuid   NOT NULL,
  binding_id       uuid   NOT NULL,
  offering_id      uuid   NOT NULL,
  field_path       text   NOT NULL CHECK (length(field_path) BETWEEN 1 AND 512),
  element_id       uuid   NOT NULL,
  element_version  integer NOT NULL CHECK (element_version >= 1),
  idempotency_key  text   NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  correlation_id   uuid   NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, binding_id),
  CONSTRAINT field_binding_offering_field_unique UNIQUE (tenant_id, offering_id, field_path)
);
COMMENT ON TABLE sf_semantics.field_binding IS
  'isolation_class=TENANT_SCOPED; tenant form field -> published semantic element (opaque ref)';
CREATE INDEX field_binding_element_idx ON sf_semantics.field_binding (element_id, element_version);
ALTER TABLE sf_semantics.field_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_semantics.field_binding FORCE ROW LEVEL SECURITY;
CREATE POLICY field_binding_tenant ON sf_semantics.field_binding
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
GRANT SELECT, INSERT ON sf_semantics.field_binding TO sf_app;
GRANT SELECT, INSERT, DELETE ON sf_semantics.field_binding TO sf_cmp058_rw;
ALTER TABLE sf_semantics.field_binding OWNER TO sf_migrator;

-- sf:isolation sf_semantics.idempotency_record TENANT_SCOPED owner=CMP-058
CREATE TABLE sf_semantics.idempotency_record (
  tenant_id          uuid   NOT NULL,
  principal_id       uuid   NOT NULL,
  endpoint           text   NOT NULL,
  idempotency_key    text   NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  request_fingerprint text  NOT NULL,
  status             text   NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  response_ref       text,
  response_status    integer,
  response_body      jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, principal_id, endpoint, idempotency_key)
);
ALTER TABLE sf_semantics.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_semantics.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idem_tenant ON sf_semantics.idempotency_record
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON sf_semantics.idempotency_record TO sf_app;
ALTER TABLE sf_semantics.idempotency_record OWNER TO sf_migrator;

-- sf:isolation sf_semantics.idempotency_record_platform PLATFORM_OPERATIONAL owner=CMP-058
CREATE TABLE sf_semantics.idempotency_record_platform (
  principal_id       uuid   NOT NULL,
  endpoint           text   NOT NULL,
  idempotency_key    text   NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  request_fingerprint text  NOT NULL,
  status             text   NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  response_ref       text,
  response_status    integer,
  response_body      jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  PRIMARY KEY (principal_id, endpoint, idempotency_key)
);
GRANT SELECT, INSERT, UPDATE ON sf_semantics.idempotency_record_platform TO sf_app;
ALTER TABLE sf_semantics.idempotency_record_platform OWNER TO sf_migrator;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA sf_semantics TO sf_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sf_semantics FROM PUBLIC;

-- Down Migration
DROP TABLE IF EXISTS sf_semantics.idempotency_record_platform;
DROP TABLE IF EXISTS sf_semantics.idempotency_record;
DROP TABLE IF EXISTS sf_semantics.field_binding;
DROP TRIGGER IF EXISTS semantic_element_immutable_tg ON sf_semantics.semantic_element;
DROP FUNCTION IF EXISTS sf_semantics.enforce_published_immutable();
DROP TABLE IF EXISTS sf_semantics.semantic_element;
DROP SCHEMA IF EXISTS sf_semantics;
