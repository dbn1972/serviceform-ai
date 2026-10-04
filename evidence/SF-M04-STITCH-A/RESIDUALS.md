# SF-M04-STITCH-A residuals

Not CERTIFIED. Not a merge instruction.

## R-CMP008-DOWN2 — CLOSED_TEST_HARNESS

| Field | Value |
|---|---|
| Class | CLASS-A TEST HARNESS / MIGRATION ISOLATION |
| Status | **CLOSED_TEST_HARNESS** after CMP-008 INT **14/14 executed** (no skip) |
| Owner | CMP-008 test harness (`services/cmp-008-rules/test/integration/**`) |
| Production migrations | unchanged |
| Closure | Isolated throwaway database + migrator directory containing only `platform-baseline`, `shared-db-contracts`, and the CMP-008 pair. Combined-catalog `node-pg-migrate down N` is not used, so CMP-013 stays applied. Combined `sf_schema_migrations` + `sf_upload` fingerprint equal before/after. Reversibility assertions retained: apply; down 2 removes `sf_rules`; `sf_cmp008_rw` NOLOGIN/NOSUPERUSER/NOBYPASSRLS retained; up restores `sf_rules`. |

## Explicit non-claims

- Not VERIFIED / Not CERTIFIED / Not RELEASE CERTIFIED / Not G6
- M05 OFF
- SF-M04-005, 006, STITCH-B, 007, INT, SEC, EVD not started
- Builder PRs #69/#70/#71/#72 not merged and not rewritten
