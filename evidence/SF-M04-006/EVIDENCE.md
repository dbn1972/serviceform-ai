# SF-M04-006 evidence (builder)

**Not CERTIFIED. Not G6. M05 OFF.** Builder cannot self-certify.

| Item | Result |
|---|---|
| Task | SF-M04-006 CMP-014 Document Intelligence / OCR |
| Base | `origin/main` `2db721feb1303385a0c50c79de8629b2478064d9` |
| Unit | 20 passed (`logs/unit.log`, `junit/unit.xml`) |
| Integration (PG16) | 4 passed (`logs/integration.log`, `junit/integration.xml`) |
| Typecheck | pass (`logs/typecheck.log`) |
| ESLint | pass (`logs/eslint.log`) |
| Migration lint | PASS (`logs/migration-lint.log`) |
| Inference | CMP-039 port only; no provider SDK |
| INT-013 | SIMULATED OCR; PRODUCTION+SIMULATED fail closed |
| INT-011 | FORCE RLS; `CROSS_TENANT_LEAKAGE=0` |
| Frozen contracts | 13/13 consumed, not modified |
| Host mount | deferred to SF-M04-007 |

## EXPECTED_STITCH_B_LOCKFILE_RESIDUAL

New workspace importer `@serviceform/cmp-014-document-intelligence` is not in `pnpm-lock.yaml`.
Isolated `pnpm install --frozen-lockfile` CI red solely from the missing importer is not a component failure.
Do not weaken frozen-lockfile, `minimumReleaseAge`, `trustPolicy`, `blockExoticSubdeps`, `.npmrc`, or `pnpm-workspace.yaml`.
