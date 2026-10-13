# SF-M08-SEC evidence — independent security verifier

**Not CERTIFIED. Not G3. Not G6. self_certified false. Recommend only.**

| Field | Value |
|---|---|
| Task | SF-M08-SEC |
| Branch | `cursor/m08-sec-sf-m08-sec-91f2` |
| Base | `50a4ed3ad474a6a1395de98c9937a50f23045cfb` (host #136 tip) |
| Model | opus / claude-opus-5-5 |
| Runner | vitest 5.0.3, node v22.14.0 |
| Command | `npx vitest run -c tests/security/m08/vitest.config.ts` |
| Local vitest | **20/20 PASS** (4 files) — `logs/vitest.log`, `junit/security.xml` |
| CROSS_TENANT_LEAKAGE | **0** |
| Production code modified | **false** |
| Retention periods invented | **false** |
| Critical findings | 0 |

## Suites

| File | Tests | What it proves |
|---|---|---|
| `forged-tenant-http.test.ts` | 4 | All 25 published M08 host routes (CMP-035/007/045/046/049/006; neutral routes read from each component's `ROUTE_DESCRIPTORS`) are live, and every one returns 403 `SF-TEN-002` (valid `error-response`) for 4 forged tenant header variants, including a header matching the caller's own tenant. Recording doubles prove zero forged requests reached `resolveContext` or any component port. Canary tenant absent from bodies and logs. |
| `static-isolation.test.ts` | 9 | For each M08 schema: `CREATE SCHEMA`, every table carries an `sf:isolation` declaration; 32 `TENANT_SCOPED` tables have `tenant_id`, ENABLE + FORCE RLS and a policy; the 12 `PLATFORM_OPERATIONAL` tables are only the frozen outbox template's `outbox_event_platform` / `inbox_event_platform` and have no `tenant_id`. `sf_cmpNNN_rw` roles are NOLOGIN NOSUPERUSER NOBYPASSRLS; no bare BYPASSRLS/SUPERUSER, DISABLE/NO FORCE RLS, or `TO PUBLIC`. No cross-schema references, no sibling-component imports, host `m08.ts` has no CMP-036 remount, SQL or period values. |
| `retention-policy-input.test.ts` | 4 | CMP-049 refuses ARCHIVE/DELETE eligibility with no owner period ref (`POLICY_INPUT_REQUIRED`) and unlisted transitions; duration-like refs (`30`, `30d`, `P1Y`, …) are rejected; the migration has no interval/period/due-date column. Uses an opaque fixture ref only — no retention period is asserted or invented. |
| `simulation-fail-closed.test.ts` | 3 | CMP-035 SIMULATED port refused in PRODUCTION, UAT, PREPROD; admitted only in LOCAL/CI/DEVELOPMENT/SIT/PERFORMANCE; REAL admitted in PRODUCTION. No other M08 component declares a SIMULATED connector boundary. |

## Observations (non-blocking)

- `*_platform` outbox/inbox tables have no RLS by design (frozen `contracts/shared/sql/outbox.template.sql`, CHECK forces envelope `tenant_id` null). Test pins them so any new unprotected table fails.
- Tests are static + in-process HTTP with doubles. Live-PostgreSQL RLS (wrong-tenant `SET app.tenant_id` reads) for M08 schemas is not exercised here; INT/EVD should cover it with a database.

## Certification stance

CERTIFIED=false · G3=false · G6=false · recommended `SF_M08_SEC_PASS` for human/CI gate.
