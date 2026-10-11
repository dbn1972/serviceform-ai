# SF-M05-007 CMP-027 builder evidence

**Not CERTIFIED. Not G4. Not G6. Do not merge. STITCH-B not started.**

| Field | Value |
|---|---|
| Task | SF-M05-007 |
| Component | CMP-027 Grievance & Feedback |
| Dispatch base | `ca57057a794739c03d0a46886577e25adf041815` |
| SHA guard | PASS (`git rev-parse origin/main` equalled dispatch_base before branch) |
| Branch | `agent/M05-grievance-SF-M05-007` |
| PR | https://github.com/dbn1972/serviceform-ai/pull/98 (draft) |
| CCR_REQUIRED | false |
| Frozen contracts | 19/19 MATCH (lock file not modified) |
| Write scope | PASS (`check_scope.py --envelope orchestrator/tasks/SF-M05-007.yaml --base origin/main`) |
| Architecture gates | 10/10 PASS (local `python3 scripts/gates/run_all.py`) |
| Unit + contract | 32/32 PASS (`vitest` unit config) |
| Typecheck | PASS (`tsc --noEmit`) |
| ESLint | PASS (`--max-warnings=0`) |
| Integration (PG FORCE RLS / isolated up-down-up) | present; local VM had no PostgreSQL — CI migrations/tenant-isolation harness is the executed PG evidence |
| `pnpm-lock.yaml` | not committed (importer row deferred to STITCH-B) |

## Acceptance (unit, executed)

- Tenant-scoped rows + ENABLE+FORCE RLS declared in migration and asserted in integration tests (CI).
- AI cannot close / resolve statutory grievance (`AI_FINAL_DISPOSITION_FORBIDDEN`); assist is advisory-only.
- Host mount not performed (`apps/**` untouched).
- No named-service/department/scheme branching (static scan + assignment named-officer reject).
- Outbox Day 1; outbound ports refused inside domain txn (`NETWORK_IO_IN_DOMAIN_TX`).
- Server-derived tenant; `X-Tenant-ID` refused (`SF-TEN-002`).

## Residuals

- Host mount: SF-M05-009
- Real OPA / Temporal / CMP-017 / M06 notification adapters
- STITCH-B lockfile importer for this package
