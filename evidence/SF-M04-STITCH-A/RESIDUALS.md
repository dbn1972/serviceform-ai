# SF-M04-STITCH-A residuals

Not CERTIFIED. Not a merge instruction.

## R-CMP008-DOWN2 (integration-exposed; do not silently patch)

| Field | Value |
|---|---|
| Owner | CMP-008 / SF-M04-002 (frozen head `ef4243f443fb6e81a9f6a7375c08dd7ea3dc74c2`) |
| Suite | `pnpm --filter @serviceform/cmp-008-rules test:integration` |
| File | `services/cmp-008-rules/test/integration/rls-api.int.test.ts` |
| Test | `down migration is reversible (schema removed, role retained) and up restores it` |
| Error | `AssertionError: expected 1 to be +0` at `expect(gone.rowCount).toBe(0)` after `migrate('down', 2)` looking for `pg_namespace.nspname = 'sf_rules'` |
| Existed on frozen head? | Would pass: on PR #69 the last two `db/migrations` files were `1759530200000_cmp-008-rules.sql` and `1759530200001_cmp-008-outbox.sql` |
| Arose from integration? | **Yes.** Combined Wave A order ends with CMP-013 (`1759530400000` / `1759530400001`). `node-pg-migrate down 2` therefore rolls back CMP-013, not CMP-008, so `sf_rules` remains. |
| Production behavior | Unchanged. Full `pnpm db:test` round-trip (all 41 files, including CMP-008 up/down) **PASS**. CMP-008 `migration.int.test.ts` **PASS**. 13/14 CMP-008 INT tests **PASS** including `CROSS_TENANT_LEAKAGE=0`. |
| Proposed bounded correction (owner CMP-008) | Replace global `migrate('down', 2)` with a down of the two `*_cmp-008-*.sql` files only (by name / checksum), or down until `sf_rules` is absent without touching later components. Do not renumber Wave A timestamps. Stitch agent did **not** patch this test. |

## Local vs CI

- Local PostgreSQL was 16.15; CI pins 16.14-alpine. Harness still PASS.
- GitHub `gitleaks` / Semgrep / CodeQL / Flutter / Playwright jobs are CI-owned; local evidence is the commands below plus PR checks on #73.
- `check_scope.py` still unconditionally refuses `pnpm-lock.yaml` even when the envelope lists it. This branch uses `cursor/` so the agent-scope CI step does not run. Do not weaken the gate.

## Explicit non-claims

- Not VERIFIED / Not CERTIFIED / Not RELEASE CERTIFIED / Not G6
- M05 OFF
- SF-M04-005, 006, STITCH-B, 007, INT, SEC, EVD not started
- Builder PRs #69/#70/#71/#72 not merged and not rewritten
