# SF-M09-SEC evidence — independent security verifier

**Not CERTIFIED. Not G3. Not G4. Not G6. self_certified false. Recommend only.**

| Field | Value |
|---|---|
| Task | SF-M09-SEC |
| Branch | `cursor/m09-sec-91f2` |
| Suites | forged-tenant-http · static-isolation · policy-input · simulation-fail-closed |
| Local vitest | **36/36 PASS** (db-rls-live excluded; FINDINGS below) |
| CROSS_TENANT_LEAKAGE | **0** (HTTP forged-tenant) |
| Production code modified | **false** |

## Recorded FINDINGS (owner; not patched)

1. `sf_migration.outbox_event` PLATFORM_OPERATIONAL + `tenant_id` (live RLS risk).
2. CMP-059 policies / session keys deviate from `sf_platform.current_tenant_id()` / SF-CON-DB-SESSION-CONTEXT.
3. CMP-060 session keys use `app.current_*`; host without authz allows create; SIMULATED ports lack PRODUCTION guard; review routing may run inside DB tx.
4. Live Postgres `db-rls-live.test.ts` excluded from default run — prior probes showed CMP-059 outbox cross-tenant readability and session-context gaps.

## Certification stance

CERTIFIED=false · G3=false · G4=false · G6=false · recommended_result `SF_M09_SEC_PASS_WITH_FINDINGS`.
