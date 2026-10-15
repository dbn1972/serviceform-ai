-- CMP-059 remediation: tenant-scoped FORCE RLS on outbox_event
-- Critical FINDING (SF-M09-SEC): PLATFORM_OPERATIONAL + tenant_id without FORCE RLS
-- allowed T2 sessions to SELECT T1 outbox rows (CROSS_TENANT_LEAKAGE Postgres).
-- Additive fix — do not rewrite 1761100000000_cmp-059-migration-workbench.sql.
-- sf:isolation sf_migration.outbox_event TENANT_SCOPED owner=CMP-059
--
-- Up Migration

ALTER TABLE sf_migration.outbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_migration.outbox_event FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outbox_event_tenant ON sf_migration.outbox_event;
CREATE POLICY outbox_event_tenant ON sf_migration.outbox_event
  USING (tenant_id = current_setting('sf.tenant_id', true)::uuid);

COMMENT ON TABLE sf_migration.outbox_event IS
  'CMP-059 transactional outbox; TENANT_SCOPED with FORCE RLS (remediation 1761100000001).';

-- Down Migration
DROP POLICY IF EXISTS outbox_event_tenant ON sf_migration.outbox_event;
ALTER TABLE sf_migration.outbox_event NO FORCE ROW LEVEL SECURITY;
ALTER TABLE sf_migration.outbox_event DISABLE ROW LEVEL SECURITY;
