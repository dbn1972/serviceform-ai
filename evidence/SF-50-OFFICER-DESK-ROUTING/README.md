# SF-50 — Role-aware officer login → desk routing (SAMPLE_LAB)

| Field | Value |
|---|---|
| Stamp | SAMPLE_LAB · LOCAL/CI only · connectors SIMULATED · **CERTIFIED=false** · **G6=false** · self_certified=false |
| Depends | SF-46 multi-desk HUMAN_TASK queue (CMP-017) — this branch builds on that desk model |
| Builder | Cursor cloud agent — evidence for human/CI gate; not self-certified |

## What changed

1. **`deskHomeForRoles`** (`apps/web-officer/lib/portal/desk.ts`): maps CMP-004 session `role_code`s to desk homes — scrutiny/approving → `/applications?desk=<role>`, helpdesk-only → `/helpdesk`, combined/multi → `/applications`, studio-only → `/`. Never branches on subject or display_name.
2. **SIM login**: IdP assertion + session POST return `roles`; `OfficerSignIn` uses `safeNext(next, deskHomeForRoles(roles))`. Explicit `?next=` still wins; open-redirect guard unchanged.
3. **Applications queue**: seeds desk filter from `?desk=` (SF-46 Select).
4. **Helpdesk landing**: `/helpdesk` desk home for SAMPLE_LAB_HELPDESK_L*; ticket UI remains SF-52.
5. **Fixtures**: helpdesk IdP persona; OPA `SAMPLE_LAB_HELPDESK_L1` session-only (fail-closed — no case decide / TASK_*).

## Executed (this branch)

| Check | Result |
|---|---|
| `vitest` desk-routing + safe-next + tasks + platform-lab | **27 passed** |
| `@serviceform/web-officer` typecheck | pass |
| Prettier on touched paths | pass |

Recommended gate: **DEVELOPED** with unit evidence; **not VERIFIED/CERTIFIED**.

## Non-claims

- No statutory role names; SAMPLE_LAB_* codes only.
- No named officers in routing or assignment.
- OPA remains fail-closed; UX routing does not grant actions.
- DigiLocker / OTP remain SIMULATED.
- CERTIFIED=false · G6=false · self_certified=false.
