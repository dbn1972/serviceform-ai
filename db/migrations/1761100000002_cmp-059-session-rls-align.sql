-- CMP-059 residual rem: align RLS policies to SF-CON-DB-SESSION-CONTEXT.
-- Policies previously used current_setting('sf.tenant_id'); platform accessor
-- sf_platform.current_tenant_id() reads app.tenant_id (FROZEN session keys).
--
-- Up Migration

DO $$
DECLARE
  t text;
  pol text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'migration_project',
    'source_profile',
    'mapping_spec',
    'migration_batch',
    'reconciliation_result',
    'cutover_manifest',
    'idempotency_record',
    'outbox_event'
  ]
  LOOP
    pol := t || '_tenant';
    EXECUTE format('DROP POLICY IF EXISTS %I ON sf_migration.%I', pol, t);
    EXECUTE format(
      'CREATE POLICY %I ON sf_migration.%I
         USING (tenant_id = sf_platform.current_tenant_id())
         WITH CHECK (tenant_id = sf_platform.current_tenant_id())',
      pol,
      t
    );
  END LOOP;
END
$$;

-- Down Migration
DO $$
DECLARE
  t text;
  pol text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'migration_project',
    'source_profile',
    'mapping_spec',
    'migration_batch',
    'reconciliation_result',
    'cutover_manifest',
    'idempotency_record',
    'outbox_event'
  ]
  LOOP
    pol := t || '_tenant';
    EXECUTE format('DROP POLICY IF EXISTS %I ON sf_migration.%I', pol, t);
    EXECUTE format(
      'CREATE POLICY %I ON sf_migration.%I
         USING (tenant_id = current_setting(''sf.tenant_id'', true)::uuid)',
      pol,
      t
    );
  END LOOP;
END
$$;
