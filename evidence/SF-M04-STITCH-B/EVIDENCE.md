# SF-M04-STITCH-B evidence — Wave B mechanical stitch + lockfile

**Decision token: none issued. Not CERTIFIED. Not RELEASE CERTIFIED. Not G6. M05 OFF.**

Do **not** merge this stitch as a certification. Do **not** merge builder PRs #74/#75. Do **not** start SF-M04-007 / INT / SEC / EVD / M05 from this stitch. M04 G3 not issued.

| Field | Value |
|---|---|
| Task | SF-M04-STITCH-B |
| Draft PR | *(bound after PR open)* |
| Branch | `cursor/m04-stitch-b-5c67` |
| Authoritative immutable head |  |
| **actual_stitch_base** (execution) | `922509ee78892029a27268078f2dfdaef2f52cce` |
| Historical planning base (envelope only; not execution) | `2db721feb1303385a0c50c79de8629b2478064d9` |
| Frozen contracts altered | **none** (13/13 MATCH) |
| Self-certified | **false** |
| CERTIFIED | **false** |

A git commit cannot contain its own object id. `Authoritative immutable head` names the first reachable evidence-bound SHA stamp; the GitHub PR tip after the bind commit is that stamp's child.

## Immutable input SHAs (not rewritten; not merged)

| Task | CMP | PR | SHA |
|---|---|---|---|
| SF-M04-005 | CMP-009 | #74 | `d8c5d7ca9a22eadfe431fa54f3602bfc0ef05ae2` |
| SF-M04-006 | CMP-014 | #75 | `fab7549ce9c29b4d5277a36f94e9a2f9d02dcee0` |

Trees for `services/cmp-009-dynamic-forms`, `services/cmp-014-document-intelligence` and the four Wave B SQL files were `git checkout <sha> -- <paths>` from those commits (byte-identical; see `tree-integrity.txt`). Builder `evidence/SF-M04-005` / `evidence/SF-M04-006` and builder handovers were not copied (outside stitch write set).

Migration timestamps preserved exactly:

- `1759530500000_cmp-009-forms.sql`
- `1759530500001_cmp-009-outbox.sql`
- `1759530600000_cmp-014-document-intelligence.sql`
- `1759530600001_cmp-014-outbox.sql`

No renumbering. No cross-component FK/SQL (self-schema FKs only).

### Tree integrity

| Tree | Source SHA | Aggregate sha256 | Result |
|---|---|---|---|
| CMP-009 + migrations | `d8c5d7c…` | `7e3abd1cb67621f67c1629c15a49d8c307d931be1ecc36a18ccc7511c3d7941c` | 51/51 MATCH |
| CMP-014 + migrations | `fab7549…` | `25c42d34ef6bd5c07173502b77ffd5a152d72ec78d90f237741835291e1a34c0` | 52/52 MATCH |

`BYTE_IDENTICAL_TO_FROZEN_INPUTS=true`. Zero semantic edits. Zero formatting/mechanical corrections to component trees.

## Lockfile

Authorized Wave B lockfile write. Importers admitted by copying **existing** main resolutions for `@fastify/rate-limit@11.2.0`, `fastify@5.12.5`, `pg@8.23.1`, `@types/pg@8.23.1`, and workspace `@serviceform/contracts`. **packages/snapshots unchanged.** No new third-party package. No unrelated upgrades. Supply-chain controls untouched. See `LOCKFILE.md`.

`pnpm install --frozen-lockfile` **PASS**.

## Local executed checks

| Check | Result | Log |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | `logs/frozen-lockfile.log` |
| `pnpm format:check` | PASS | `logs/format-check.log` |
| `pnpm lint` | PASS | `logs/lint.log` |
| `pnpm typecheck` | PASS | `logs/typecheck.log` |
| `pnpm test:coverage` | PASS 856 tests; stmt 83.98 / branch 72.65 / fn 90.28 / line 87.82 | `logs/coverage-root.log` |
| `pnpm contracts:validate` | PASS | `logs/contracts-validate.log` |
| `contracts_lock_gate.py` | PASS 13/13 FROZEN | `logs/contracts-lock.log` |
| `pnpm test:cdc` | PASS 19 | `logs/cdc.log` *(alias `test-cdc.log`)* |
| `pnpm deps:graph` | PASS 1031 modules | `logs/deps-graph.log` |
| `pnpm build` | PASS | `logs/build.log` |
| `python3 -m pytest scripts/gates/tests` | PASS 25 | `logs/gates-selftest.log` |
| `python3 scripts/gates/run_all.py` | PASS 10/10 | `logs/architecture-gates.log` |
| `migration_lint.py` | PASS 45 files | `logs/migration-lint.log` |
| `pnpm db:test` | PASS 3 files / 17 tests (tenant-isolation harness) | `logs/db-test.log` |
| M01 envelope `scripts/ci/run-m01-envelope-int.sh` | PASS 16 suites, fail_count 0 | `logs/m01-envelope-int.log` + `m01-envelope-int/` |
| `pnpm audit --prod --audit-level high` | PASS no known vulns | `logs/pnpm-audit-prod.log` |
| CMP-009 unit/contract | **30 PASS** (floor ≥30) | `logs/cmp-009-unit.log` + `junit/cmp-009-unit.xml` |
| CMP-009 int | **9 PASS** (floor ≥9); `CROSS_TENANT_LEAKAGE=0` | `logs/cmp-009-int.log` + `junit/cmp-009-int.xml` |
| CMP-014 unit/contract | **20 PASS** (floor ≥20) | `logs/cmp-014-unit.log` + `junit/cmp-014-unit.xml` |
| CMP-014 int | **4 PASS** (floor ≥4); `CROSS_TENANT_LEAKAGE=0` | `logs/cmp-014-int.log` + `junit/cmp-014-int.xml` |

## Security reconfirm

| Gate | Result |
|---|---|
| contracts | **13/13 MATCH** |
| frozen_contract_change | **false** |
| CROSS_TENANT_LEAKAGE | **0** |
| runtime_object_owner | **false** (objects owned by `sf_migrator`; runtime roles NOLOGIN) |
| SUPERUSER | **false** |
| BYPASSRLS | **false** |
| cross_component_SQL | **false** |
| apps/api_changed | **false** |
| direct_model_provider_outside_CMP039 | **false** |
| statutory_AI_decision_path | **false** (`statutory_decision: false` forced) |
| second_design_system | **false** |

CMP-009/014 specifics: FORCE RLS on tenant-scoped tables in `sf_forms` / `sf_docintel`; platform outbox/inbox tables without tenant RLS unchanged pattern; AiGatewayPort-only inference for CMP-014; UX4G-only constitution asserts for CMP-009. See `logs/architecture-reconfirm.log`.

## Residuals

See `RESIDUALS.md`. Lockfile residual closed. No open semantic residuals for STITCH-B.

## Recommended next (orchestrator)

1. Review draft STITCH-B PR CI/security/developer-platform on the immutable head (do not merge).
2. Hold merge until separate authorization. Do not start 007/INT/SEC/EVD/M05. Do not merge #74/#75. M04 G3 not issued.
