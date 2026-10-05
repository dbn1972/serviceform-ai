# SF-M05-002 — CMP-016 Workflow Engine: builder evidence (R-CMP016-DOWN2 test-harness remediation)

Builder evidence only. **Not CERTIFIED. Not G4. Not G6. STITCH-A OFF. Builder does not self-certify.**
Independent INT / SEC / EVD verification is still required.

| Field | Value |
|---|---|
| Task / component | SF-M05-002 / CMP-016 (INT-005, INT-011) |
| Residual | R-CMP016-DOWN2 (raised by STITCH-A [#91](https://github.com/dbn1972/serviceform-ai/pull/91) @ `2135940`, frozen; not modified) |
| Base SHA | `6e9f0481eb3007dedee5580838cab59ceea66f03` (unchanged; no rebase) |
| Previous head | `50f56aff9cc1e46c927b881f30c249cb9e1955d2` (evidence for code `4ea552d` archived in `history/4ea552d/`) |
| Code SHA under test | `b01ed4cce98078a17f19f35f4c9118c085f4acb9` (`logs/commit-sha.txt`) |
| PR | [#89](https://github.com/dbn1972/serviceform-ai/pull/89) (draft, do not merge) |
| Environment | Local: Node 22.14.0, pnpm 10.28.0, PostgreSQL 16 (apt), Temporal time-skipping test server via `@temporalio/testing` 1.24.0 |
| Model | claude-opus-5-5 (high), builder role |

## Root cause (test defect, not product/migration defect)

`test/integration/migration.int.test.ts` at `50f56af` assumed the CMP-016 pair is the global tail of
`db/migrations`: it asserted `applied().slice(-2) == MIGRATIONS` and ran a global `node-pg-migrate down 2`.
On the combined Wave A chain CMP-017 (`1759540170000/1`) and CMP-029 (`1759540400000/1`) sort after CMP-016,
so the tail assertion saw CMP-029 and `down 2` rolled back **CMP-029**, leaving `sf_workflow` in place.
Reproduced locally with the 50f56af test files on the combined chain: 2 failed / 19 passed
(`logs/combined-wave-a-old-test-repro.log`: expected `cmp-016-*`, received `cmp-029-*`; `sf_workflow` still present after `down 2`).

## Change (test harness only; 2 files)

| File | Change |
|---|---|
| `test/integration/helpers.ts` | `CMP016_MIGRATION_FILES`, `CMP016_ISOLATED_CHAIN`, `withIsolatedCmp016Database(...)`, `snapshotCombinedCatalog(...)` mirroring the accepted CMP-008 pattern (`services/cmp-008-rules/test/integration/helpers.ts`). Combined-chain `migrate()` is now typed `up` only. |
| `test/integration/migration.int.test.ts` | Combined chain: presence + order only (no tail assertion, no global down). Reversibility: isolated DB only. Test count unchanged (3; suite 21). |

Isolated chain (throwaway DB `sf_cmp016_rev_<8 hex>`, name allowlisted by regex, temp migrations dir via `mkdtemp`):

1. `1759482000000_platform-baseline.sql` — creates `sf_app`
2. `1759490000000_shared-db-contracts.sql` — `sf_platform.current_tenant_id()` and `sf_outbox_publisher`
3. `1759540160000_cmp-016-workflow-engine.sql`
4. `1759540160001_cmp-016-outbox.sql`

No other prerequisite: the CMP-016 pair references only `sf_app`, `sf_platform.current_tenant_id()`,
`sf_outbox_publisher` and its own `sf_workflow` objects, and creates `sf_migrator` / `sf_cmp016_rw` itself
(grep of both files). Up on the 4-file chain succeeds; that is the executed proof.

Cleanup: `try/finally` closes the client, then `DROP DATABASE IF EXISTS … WITH (FORCE)`, then (in a nested
`finally`) removes the temp dir, so the dir is removed even if the drop fails. The test asserts release on the
success path **and** on an injected-failure path (DB absent in `pg_database`, temp dir absent, zero
`sf_cmp016_rev_*` databases left).

## Assertions now made

| Scope | Assertion |
|---|---|
| Combined chain | Both CMP-016 migrations applied, `cmp-016-outbox` after `cmp-016-workflow-engine`, both after `shared-db-contracts`; `sf_workflow` exists with 10 tables; RLS + FORCE RLS on the 8 tenant tables (the 2 `*_platform` tables are PLATFORM_OPERATIONAL by the shared outbox contract). Later migrations may follow. |
| Isolated up | Applied list equals the 4-file chain; `sf_workflow` exists; 10 tables |
| Isolated down 2 | `sf_workflow` gone; both CMP-016 names removed; applied list equals baseline + shared-db-contracts; `sf_cmp016_rw` retained |
| Isolated up again | Pair re-applied; 10 tables owned by `sf_migrator`; RLS + FORCE on tenant tables; table/FORCE list, `pg_policies` and the full `sf_workflow` grant matrix **equal to the combined DB's**; `sf_cmp016_rw` NOLOGIN/NOBYPASSRLS/NOSUPERUSER; PUBLIC grants 0 |
| Combined catalogue | Snapshot (migration names, `sf_workflow` tables incl. `relfilenode`, policies, grants) identical before and after the isolated run and after the failure-path run |

## Executed checks (`logs/exit-codes.txt`, code SHA `b01ed4c`)

| Step | Result |
|---|---|
| frozen install | rc=1, EXPECTED_STITCH_LOCKFILE_ADMISSION (sole reason: 6 `@temporalio/*` specifiers; `logs/install-frozen.log`) |
| format:check / lint / typecheck (recursive) | rc=0 / rc=0 / rc=0 |
| root `test:coverage` | rc=0, 171 files / 1002 tests; CMP-016 src lines 93.44%, branches 88.09% (identical to prior run) |
| contracts:validate / test:cdc / deps:graph / build | rc=0 each |
| gate self-tests / `run_all.py` | 25 passed / 10/10 PASS (incl. cg01-path-uniqueness, workflow-pin, agent-rules) |
| migration lint / contracts lock / write scope | PASS (47 files) / 19/19 FROZEN MATCH / PASS (106 files vs `origin/main`, envelope SF-M05-002) |
| `pnpm db:test` | rc=0, 17/17 (single-database cluster; see note 2) |
| CMP-016 unit + contract | rc=0, 9 files / 136 tests (`junit/unit.xml`) |
| CMP-016 Postgres integration, #89 tree | rc=0, **21/21** (`junit/integration.xml`) |
| CMP-016 Postgres integration, **combined Wave A chain** | rc=0, **21/21** (`junit/integration-combined-wave-a.xml`); post-conditions in `logs/combined-wave-a-postconditions.log`: CMP-015/016/017/029 all still applied, `sf_tasks`/`sf_sla` present, 0 leftover isolated DBs / temp dirs |
| CMP-016 Temporal SDK suite | rc=0, **12/12** (`junit/temporal.xml`) |

Combined chain = CMP-015/017/029 migration files copied read-only from STITCH-A head `2135940` into the
working tree for the run and deleted afterwards (`logs/worktree-after.log` empty). CMP-016 migration files are
blob-identical between this branch and `2135940`. Nothing from the overlay was committed.

## Preserved

- CROSS_TENANT_LEAKAGE = 0 (`db-isolation.int.test.ts` FORCE-RLS suite, both runs).
- Semantic diff vs `50f56af` outside the two test files = 0: `src/**`, `db/migrations/**`, `package.json`, vitest configs, `contracts/**`, `orchestrator/contracts-lock.yaml`, `pnpm-lock.yaml`, `apps/**` untouched.
- contracts lock 19/19 MATCH; CCR_REQUIRED false. No Temporal semantic change; no dependency change.

## Notes / residuals (not fixed here; outside allowed write paths)

1. **R-CMP016-UNHANDLED-REJECTION (pre-existing, intermittent).** `db-isolation.int.test.ts` test "service layer: tenant B cannot export, start, signal or request on tenant A data" builds three service promises eagerly and awaits them one by one, so a later rejection can be reported by vitest as an unhandled rejection (`Errors 1`, rc=1) while all 21 tests pass. Frequency with the **unchanged 50f56af test files**: 3/8 runs (`logs/unhandled-frequency-old-files-m89-only.log`); with the remediated files: 1/8 (`…-new-files-m89-only.log`), 2/6 on the combined chain (`…-new-files-combined.log`); file alone: 0/8. The file is byte-identical to `50f56af`. Fix (lazy thunks or `Promise.allSettled`) needs authorization to edit that file. The canonical evidence runs above had 0 occurrences.
2. **`db:test` on a shared cluster.** The first `db:test` attempt ran on a cluster that also held the combined-chain test DBs; its global `down 47` could not drop the cluster-wide role `sf_cmp013_rw` because objects in those other DBs depend on it (`logs/db-test-multidb-cluster-artifact.log`). Re-run on a single-database cluster (as in CI): 17/17. The CMP-016 isolated DB is always dropped, so it leaves no such dependency (asserted).
3. EXPECTED_STITCH_LOCKFILE_ADMISSION unchanged; lockfile is STITCH-A owned.
