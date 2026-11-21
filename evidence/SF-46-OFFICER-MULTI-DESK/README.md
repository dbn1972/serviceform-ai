# SF-46 — SAMPLE_LAB Officer multi-desk HUMAN_TASK queue (CMP-017 residual)

| Field | Value |
|---|---|
| Stamp | SAMPLE_LAB · LOCAL/CI only · connectors SIMULATED · **CERTIFIED=false** · **G6=false** · self_certified=false |
| Residual | CMP-017 human-task-from-graph (officer queue by Studio `role_code`, not single Approve/Reject only) |
| Builder | Cursor cloud agent — evidence for human/CI gate; not self-certified |

## What changed

1. **Lab workflow graph** (`fixtures/lab/platform/workflow.json`): `WAIT_UNDER_SCRUTINY` and `WAIT_DECISION_PENDING` are `HUMAN_TASK` nodes with assignment `{ role_code, organisation_id, jurisdiction_id }` (SAMPLE_LAB labels only). New immutable workflow version pins (`…001d`).
2. **CMP-016 → CMP-017**: lab Temporal activity `humanTasks` port creates/cancels CMP-017 tasks; SYSTEM sequencer gets `TASK_CREATE` / `TASK_CANCEL_CLOSE`. OPA `required_role` applies to officers, not SYSTEM.
3. **Host**: `DATABASE_URL_CMP017` / `sf_lab_cmp017`; mounts CMP-017 `/v1/tasks*`; PrincipalScopePort widens desk officers to lab org/jurisdiction.
4. **Officer UI**: desk filter by `role_code`; scrutiny **Forward for approval** vs approving **Approve/Reject**; claim on act; fail-closed OPA.

## Executed (this branch)

| Check | Result |
|---|---|
| `vitest` platform-lab-tasks, platform-lab, platform-lab-workflow, cmp-017 lifecycle, web-officer tasks | pass |
| Format (prettier on TS/JSON) | pass |

CI on the PR re-runs full gates (OPA, e2e, typecheck). Recommended gate: **DEVELOPED** with executed unit evidence; **not VERIFIED/CERTIFIED**.

## Non-claims

- No statutory role names invented; SAMPLE_LAB_* codes only.
- No LLM decision on the path.
- DigiLocker / OTP remain SIMULATED.
- CERTIFIED=false · G6=false.
