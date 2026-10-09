# Agent handovers
Each task writes `<task-id>.yaml` containing base/result commit, completed work, unresolved work, changed contracts/migrations, blockers, risks and evidence references. Chat history is not a durable handoff.

## CG-02 / M06 / M08 (current planning)

Planning envelopes (`CG-02-PLAN.yaml`, `M06-PLAN.yaml`, `M08-PLAN.yaml`, `SF-M06-*.yaml`, `SF-M08-*.yaml`) are **PLANNING only**: `planning_only: true`, `implementation_authorized: false`, not READY, not dispatched, not CERTIFIED. See `docs/planning/CG-02-M06-M08-PLAN.md`. Builders OFF. Contract freeze OFF (`CG_02_CONTRACT_FREEZE_REQUIRED=true`). M07+ OFF. Do not create `orchestrator/tasks/**` mirrors until a later READY/dispatch authorization.

## CG-01 / M02 / M03

Implementation envelopes (`CG-01-PLAN.yaml`, `M02-PLAN.yaml`, `M03-PLAN.yaml`, `SF-M02-*.yaml`, `SF-M03-*.yaml`) are **READY**: `planning_only: false`, `implementation_authorized: true`, not dispatched, not CERTIFIED. See `docs/planning/CG-01-PROMOTE-READY.md`. Builders remain OFF until a later orchestrator dispatch.

## Historical (on main)

- M01 Wave 2: see `docs/planning/M01-WAVE2-PLAN.md` and `M01-WAVE2-PLAN.yaml`.
- M01 G4 exit: token issued (human); see `docs/verification/M01-G4-EXIT.md` and `M01-G4-EXIT-GATE.yaml`.
