-- sf:isolation example.loose JURISDICTION_SCOPED owner=CMP-017
-- Up Migration
CREATE TABLE example.loose (id uuid PRIMARY KEY, tenant_id uuid);
ALTER TABLE example.loose ENABLE ROW LEVEL SECURITY;
ALTER TABLE example.loose FORCE ROW LEVEL SECURITY;
CREATE POLICY loose_tenant ON example.loose USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- Down Migration
SELECT 1;
