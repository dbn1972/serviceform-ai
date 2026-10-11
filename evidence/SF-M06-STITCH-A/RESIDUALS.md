# Residuals — SF-M06-STITCH-A

1. **EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL** — **CLOSED**. Three empty importers admitted; frozen install PASS.
2. **CMP-020_MIGRATION_ORDERING** — **CARRIED (acknowledged)**. Combined tip is CMP-020 (`1759620200000` / `1759620200001`); CMP-020 tip `migrateDown(2)` PASS on combined catalogue.
3. **CMP-025 tip-count migrateDown** — **CLOSED via #118 correction** `b6944169…` (named isolated reversibility; 13/13 PASS on stitched tree).
4. Other carried builder residuals (PORT_ADAPTERS_UNBOUND, CONNECTOR_TYPE_GAP, SCHEMA_PARTICIPANT_TENANT, ADAPTERS_UNBOUND, HOST_MOUNTS_DEFERRED, FACTS_SOURCE_OPEN) remain **unresolved** / deferred per envelope — not stitcher scope.
