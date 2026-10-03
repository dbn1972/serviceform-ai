-- sf:isolation example.thing TENANT_SCOPED owner=CMP-002
-- Up Migration
CREATE SCHEMA example;
CREATE TABLE example.thing (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL
);
ALTER TABLE example.thing ENABLE ROW LEVEL SECURITY;
ALTER TABLE example.thing FORCE ROW LEVEL SECURITY;
-- current_setting('app.tenant_id') in a comment is fine
CREATE POLICY thing_tenant ON example.thing
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- Down Migration
-- sf:allow-destructive ADR-0000
DROP TABLE example.thing;
DROP SCHEMA example;
