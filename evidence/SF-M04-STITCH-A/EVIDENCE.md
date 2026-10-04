# SF-M04-STITCH-A evidence — Wave A mechanical stitch + lockfile

**Decision token: none issued. Not CERTIFIED. Not RELEASE CERTIFIED. Not G6. M05 OFF.**

Do **not** merge this stitch as a certification. Do **not** merge builder PRs #69/#70/#71/#72.

| Field | Value |
|---|---|
| Task | SF-M04-STITCH-A |
| Draft PR | https://github.com/dbn1972/serviceform-ai/pull/73 |
| Branch | `cursor/m04-stitch-a-7000` |
| Authoritative immutable head | PENDING_BIND (filled on bind commit; must match final PR HEAD) |
| Historical heads | trees `c45d232`; lockfile `6fd5d3f8dcdd50d80486a090e3316960d058130e`; evidence `a09530123b0af9189d0cfcba4e2cf2bfbac60cbe`; previous candidate `50b65c8c1324132ec6f5fb802525a57c66b143a7` |
| Base | `origin/main` `9ccc2b02f8ef64a0987b0c4793137511545ed3f7` |
| Frozen contracts altered | **none** (13/13 MATCH) |
| Self-certified | **false** |
| CERTIFIED | **false** |

## Immutable input SHAs (not rewritten)

| Task | CMP | PR | SHA |
|---|---|---|---|
| SF-M04-001 | CMP-039 | #71 | `6ff96acfda899549aa2b6c5212e94f73be6c041c` |
| SF-M04-002 | CMP-008 | #69 | `ef4243f443fb6e81a9f6a7375c08dd7ea3dc74c2` |
| SF-M04-003 | CMP-011 | #70 | `702682d2bdb7505ba7022b120545412d76f9d6d4` |
| SF-M04-004 | CMP-013 | #72 | `9dbef93e106cb7b6bce1092fc4e6dfea02e05ec2` |

Trees for `services/cmp-039-ai-gateway`, `services/cmp-008-rules`, `services/cmp-011-evidence-requirements`, `services/cmp-013-document-upload` and the eight Wave A SQL files were `git checkout <sha> -- <paths>` from those commits (byte-identical to frozen heads at integrate time). Builder `evidence/SF-M04-00x` and builder handovers were not copied (outside stitch write set).

Migration timestamps preserved: `1759530039*` (CMP-039), `1759530110*` (CMP-011), `1759530200*` (CMP-008), `1759530400*` (CMP-013). No renumbering. No cross-component FK/SQL.

## Lockfile

Authorized stitch lockfile write. `pnpm install --lockfile-only` against the combined importers **failed** with:

`ERR_PNPM_NO_MATURE_MATCHING_VERSION Version 8.23.1 (released 4 days ago) of pg does not meet the minimumReleaseAge constraint`

Policy was **not** waived (`minimumReleaseAge`, `trustPolicy`, `blockExoticSubdeps`, `.npmrc`, `pnpm-workspace.yaml` unchanged). Importers were admitted by copying **existing** main resolutions for `pg@8.23.1`, `@types/pg@8.23.1`, `fastify@5.12.5`, `@fastify/rate-limit@11.2.0` / `fastify-rate-limit` npm alias, `fastify-plugin@5.1.0`, workspace links.

New package `@gorules/zen-engine@2.0.2` (published 2026-08-24, mature vs 7-day age) was resolved in an isolated probe **with the same supply-chain controls**, then merged. Optional native/wasm peers at 2.0.2 plus missing `@emnapi/core@1.11.3`, `@emnapi/wasi-threads@1.2.3`, `@napi-rs/wasm-runtime@1.2.4`, `@tybys/wasm-util@0.10.4`. Existing `@emnapi/runtime@1.11.3` and `tslib@2.8.1` reused. **No 2.1.x.** Zero integrity changes to packages already on main.

`pnpm install --frozen-lockfile` **PASS**.

## Local executed checks

| Check | Result | Log |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | `logs/frozen-lockfile.log` |
| `pnpm format:check` | PASS | `logs/format-check.log` |
| `pnpm lint` | PASS | `logs/lint.log` |
| `pnpm typecheck` | PASS | `logs/typecheck.log` |
| `pnpm test:coverage` | PASS 806 tests; stmt 85.14 / branch 74.39 / fn 90.91 / line 88.54 | `logs/coverage-root.log` |
| `pnpm contracts:validate` | PASS | `logs/contracts-validate.log` |
| `contracts_lock_gate.py` | PASS 13/13 FROZEN | `logs/contracts-lock.log` |
| `pnpm test:cdc` | PASS 19 | `logs/cdc.log` |
| `pnpm deps:graph` | PASS 955 modules | `logs/deps-graph.log` |
| `pnpm build` | PASS | `logs/build.log` |
| `python3 -m pytest scripts/gates/tests` | PASS 25 | `logs/gates-selftest.log` |
| `python3 scripts/gates/run_all.py` | PASS 10/10 | `logs/architecture-gates.log` |
| `migration_lint.py` | PASS 41 files | `logs/migration-lint.log` |
| `pnpm db:test` | PASS 3 files / 17 tests | `logs/db-test.log` |
| M01 envelope `scripts/ci/run-m01-envelope-int.sh` | PASS 16 suites, fail_count 0 | `logs/m01-envelope-int.log` + `m01-envelope-int/` |
| `pnpm audit --prod --audit-level high` | PASS no known vulns | `logs/pnpm-audit-prod.log` |
| CMP-039 unit | 51 PASS (baseline 51) | `logs/cmp-039-unit.log` |
| CMP-039 int | 10 PASS (baseline 10); `CROSS_TENANT_LEAKAGE=0` | `logs/cmp-039-int.log` |
| CMP-008 unit | 56 PASS (baseline 56) | `logs/cmp-008-unit.log` |
| CMP-008 int | **14 PASS / 0 FAIL** (baseline 14; no skip). R-CMP008-DOWN2 **CLOSED_TEST_HARNESS** | `logs/cmp-008-int.log` |
| CMP-011 unit | 108 PASS (baseline 108) | `logs/cmp-011-unit.log` |
| CMP-011 int | 13 PASS (baseline 13) | `logs/cmp-011-int.log` |
| CMP-013 unit | 66 PASS (baseline 66) | `logs/cmp-013-unit.log` |
| CMP-013 int | 11 PASS (baseline 11) | `logs/cmp-013-int.log` |

Developer-platform additive gates (`migration_lint`, `openapi_asyncapi`, `workflow_pin`, `contracts_lock`, `run_all`) covered by architecture gates PASS. CMP-055 unit is inside M01 envelope PASS.

## Architecture reconfirm (Wave A trees)

See `logs/architecture-reconfirm.log`. Roles created `NOLOGIN NOSUPERUSER … NOBYPASSRLS` (`sf_cmp039_rw`, `sf_cmp008_rw`, `sf_cmp011_rw`, `sf_cmp013_rw`). ENABLE+FORCE RLS on tenant-scoped tables. No cross-component schema SQL in Wave A migrations. No model-provider HTTP outside CMP-039. CMP-039 `statutory_decision: false` / statutory-guard; SIMULATED fail-closed in PRODUCTION. CMP-008 pins `@gorules/zen-engine@2.0.2`; no `eval`/`Function`/`fetch` in `src/`. CMP-013 has no durable local `writeFile` upload path in `src/`. No provider API keys in CMP-039 `src/`. Frozen `contracts/**` untouched.

## Residuals

`RESIDUALS.md` — **R-CMP008-DOWN2 CLASS-A TEST HARNESS: CLOSED_TEST_HARNESS**. Isolated CMP-008 migrator DB; combined catalog / CMP-013 fingerprint unchanged. No production migration edit.

`summary.json` binds base + four frozen input SHAs.

## Recommended next (orchestrator)

1. Review draft PR #73 CI on the new immutable head (do not merge on this stitch alone).
2. After stitch merge to `main` **and** human LOCK-3, Wave B (005/006) may start. Not started here.
