# SF-WS5-G6-PREP — Workstream 5 agent-buildable G6 prep

**CERTIFIED=false · G6=false · self_certified=false · g6_issued=false**  
**DigiLocker REAL=false · SMS/OTP REAL=false · Payment REAL=false**  
**ADR-0007 Status=PROPOSED · ADR-0008 Status=PROPOSED** (not fake-accepted)

| Field | Value |
|---|---|
| Workstream | 5 — Owner blockers / G6 prep |
| Branch | `cursor/ws5-g6-prep-harness-599a` |
| Tip (at evidence write) | `91a0be6f` |
| Scope | Checklists, config **name** stubs, ADR accept readiness notes, PERF/resilience/backup-rollback harness scaffolds, lab hold execution |

## Executed lab holds (this pack)

| Suite | Result | Log / junit |
|---|---|---|
| G5 hold + harness scaffold | **6 passed · 2 skipped** | `logs/g5-hold.log`, `junit/g5-hold.xml` |
| Resilience hold + backup/rollback scaffold | **6 passed · 2 skipped · 2 todo** | `logs/resilience-hold.log`, `junit/resilience-hold.xml` |
| G6 connector hold + prep stubs | **10 passed · 3 todo** | `logs/connector-prep.log`, `junit/connector-prep.xml` |

READY flags intentionally **unset**: `SF_M10_G5_PERF_READY`, `SF_M10_RESILIENCE_READY`, `SF_M10_UX4G_READY`.

## Artifacts added (repo)

- `docs/verification/g6-prep/` — REAL switch checklist, ADR readiness, owner blockers, config stubs
- `tests/performance/m10/g5-harness-scaffold.test.ts`
- `tests/resilience/m10/backup-rollback-{checklist.yaml,scaffold.test.ts}`
- `tests/integration/m10/g6-prep-stubs.test.ts`
- `scripts/g6-prep/run-lab-holds.sh`

## Explicit non-claims

Does **not** complete DigiLocker/SMS/Payment REAL. Does **not** accept ADRs. Does **not** issue G6 or CERTIFIED. Load-profile and resilience targets remain `null` / OWNER_REQUIRED.
