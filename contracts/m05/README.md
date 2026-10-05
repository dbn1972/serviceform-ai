# M05 contracts (FROZEN)

Status of every artifact in this directory: **FROZEN**.

This is the SF-M05-CG-001 **freeze preparation** candidate. It appends six NEW
rows to `orchestrator/contracts-lock.yaml`. Repository freeze is **not** effective
until this PR merges to `origin/main` (not authorized in this slice). Wave A is
**not** eligible. ADR-0003 and ADR-0005 are **ACCEPTED** (Debabrata Nayak, 5 October 2026).

The existing 13 shared contracts under `contracts/shared/` remain FROZEN and unmodified.

| ID | File | Owner | Subject |
|---|---|---|---|
| SF-CON-APPLICATION-CASE-SM | `schemas/application-case-sm.schema.json` | CMP-015 | Authoritative case states/transitions (AWS v1.7 §12.1). `WITHDRAWAL_REQUESTED` / `CANCELLATION_REQUESTED` are not states (ADR-0003). |
| SF-CON-WORKFLOW-MODEL | `schemas/workflow-model.schema.json` | CMP-016 | Canonical workflow graph. Temporal runtime. BPMN import/export profile only. No named officer. |
| SF-CON-COMMAND-TRANSITION | `schemas/command-transition.schema.json` | CMP-015 | Domain commit before Temporal advance (Constitution #10, #11). |
| SF-CON-HUMAN-TASK | `schemas/human-task.schema.json` | CMP-017 | Create/claim/unclaim/reassign/complete/cancel-close. Assignment = role + org + jurisdiction + scope. |
| SF-CON-SLA-CLOCK | `schemas/sla-clock.schema.json` | CMP-029 | Clock anchors, calendar version, pause/resume (INT-009), breach, escalation. Notification is an M06 port. |
| SF-CON-VERSION-PINNING | `schemas/version-pinning.schema.json` | CMP-015 | Pinned execution graph vs runtime authorization `policy_revision` (ADR-0005). |

Catalog: `catalog.json`. Examples: `examples/valid`, `examples/invalid`.
Validate with `evidence/SF-M05-CG-001/validate-m05-schemas.mjs` (does not mutate `packages/contracts`).
