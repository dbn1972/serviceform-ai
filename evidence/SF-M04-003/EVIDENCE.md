# SF-M04-003 evidence — CMP-011 Evidence & Document Requirement Engine

**Not CERTIFIED. Not VERIFIED. Not RELEASE CERTIFIED. Not G6. M05 OFF.** Builder self-certification is false.

| Field | Value |
|---|---|
| Task | SF-M04-003 (M04 Wave A, LOCK-2) |
| Component / INT | CMP-011 / INT-011, INT-013 |
| Base | `origin/main` `9ccc2b02f8ef64a0987b0c4793137511545ed3f7` |
| Branch | `cursor/sf-m04-003-cmp-011-evidence-aa34` |
| Implementation commit under test | see `logs/head-sha.txt` |
| Environment | local VM, PostgreSQL 16 (apt), Node 22.14, pnpm 10.28 |
| Connector modes | DigiLocker SIMULATED only (INT-013); upload/OCR/consent/binding/approval via test-double ports |
| Frozen contracts | unchanged, 13/13 FROZEN (`logs/contracts-lock.log`) |
| `pnpm-lock.yaml` | not committed |

## Results (builder-executed)

| Check | Result | Log |
|---|---|---|
| typecheck | PASS | `logs/typecheck.log` |
| eslint (`--max-warnings=0`) / prettier | PASS | `logs/eslint.log`, `logs/prettier.log` |
| unit + contract (4 files) | 107 passed | `logs/unit.log`, `junit/unit.xml` |
| integration (PostgreSQL: migration, privilege boundary, RLS + API) | 13 passed | `logs/integration.log`, `junit/integration.xml` |
| coverage (unit+int) | stmts 93.6%, branches 87.6%, funcs 96.8%, lines 97.1% | `logs/coverage.log` |
| dependency-cruiser (no cross-component imports) | PASS | `logs/depcruise.log` |
| `scripts/gates/run_all.py` | 10/10 PASS (migration lint, contracts lock 13/13, openapi/asyncapi, hardcoding, cg01 uniqueness unchanged) | `logs/gates.log` |
| `check_scope.py` against the envelope | PASS | `logs/check-scope.log` |
| `pnpm --filter @serviceform/db test:integration` | 17 passed (all migrations apply; down/up of CMP-011 verified) | run in session |
| Tables / RLS / owner | all 5 tenant-scoped tables ENABLE+FORCE RLS, owner `sf_migrator` | `logs/rls-roles.log` |
| Runtime role | non-superuser, non-BYPASSRLS, not table owner, cannot DISABLE/NO FORCE RLS, DROP, TRUNCATE, DELETE | `privilege-boundary.int.test.ts` |
| CROSS_TENANT_LEAKAGE | 0 (T2 reads of policy/resolution/idempotency return no T1 rows; T1 content hash never in T2 responses; forged T1 insert refused by WITH CHECK) | `rls-api.int.test.ts` |

## Requirement coverage

- Published metadata drives requirements: `resolver.test.ts`, `plugin-http.test.ts` (pinned v1 vs v2), `rls-api.int.test.ts`.
- Alternative evidence sets: every branch (first, second, multi-item AND, earliest-satisfied, tie-break) in `resolver.test.ts`.
- DigiLocker vs upload: preference order, availability, fallback, outage degradation, expired document, consent required, SimulationMarker required, PRODUCTION/REAL refused.
- No sibling imports: `contracts.test.ts` source scan plus dependency-cruiser.
- Tenant isolation: memory-repository negative tests plus PostgreSQL RLS tests.

## Residuals

| Item | Owner |
|---|---|
| `pnpm install --frozen-lockfile` fails in CI until `pnpm-lock.yaml` gains the `@serviceform/cmp-011-evidence-requirements` importer (builders must not commit the lockfile) | orchestrator / SF-M04-STITCH-A |
| Real CMP-052/013/014/030/051 port bindings and host mount | SF-M04-007 |
| Independent INT/SEC verification, performance, evidence gate | SF-M04-INT / SEC / EVD (not started) |

Recommended gate: **IMPLEMENTATION_READY** for independent Verify. Human/CI only.
