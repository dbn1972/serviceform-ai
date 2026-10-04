# Agent handovers
Each task writes `<task-id>.yaml` containing base/result commit, completed work, unresolved work, changed contracts/migrations, blockers, risks and evidence references. Chat history is not a durable handoff.

## CG-01 / M02 / M03 (current)

Planning envelopes (`CG-01-PLAN.yaml`, `M02-PLAN.yaml`, `M03-PLAN.yaml`, `SF-M02-*.yaml`, `SF-M03-*.yaml`) are **PLANNING only**: `planning_only: true`, `implementation_authorized: false`, not READY, not dispatched. See `docs/planning/CG-01-M02-M03-PLAN.md`.

## Historical (on main)

- M01 Wave 2: see `docs/planning/M01-WAVE2-PLAN.md` and `M01-WAVE2-PLAN.yaml`.
- M01 G4 exit: token issued (human); see `docs/verification/M01-G4-EXIT.md` and `M01-G4-EXIT-GATE.yaml`.
