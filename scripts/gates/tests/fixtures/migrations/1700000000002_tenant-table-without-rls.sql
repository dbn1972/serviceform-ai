-- sf:isolation example.bad TENANT_SCOPED owner=CMP-002
-- Up Migration
CREATE TABLE example.bad (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
ALTER TABLE example.bad ENABLE ROW LEVEL SECURITY;
-- Down Migration
DROP TABLE example.bad;
