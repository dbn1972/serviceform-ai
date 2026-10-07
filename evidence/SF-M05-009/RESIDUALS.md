# SF-M05-009 residuals (carried, not waived)

**Not CERTIFIED. Not G4. Not G6.** Host composition does not resolve or waive governing residuals.

## CMP-019 — GOVERNING_UNRESOLVED_UNWAIVED

- Governing store record: project store `docs/m05-006-cmp019.md`
- STITCH-B carry-forward: `evidence/SF-M05-STITCH-B/RESIDUALS.md`
- Material residual: post-commit reconciliation for CMP-015 commands, CMP-029 SLA pause/resume, notification/retry, durable/idempotent recovery; `case_expected_state`|`version` not in event payload / INT-009 + EVD must prove
- SF-M05-009 action: **host adapt only** via `buildDeficiencyApi` / `.handle`. **Did not** modify `services/cmp-019-deficiency/**`. **Did not** waive.

## CMP-028 — GOVERNING_UNRESOLVED_UNWAIVED

- Governing store record: project store `docs/m05-008-cmp028.md`
- STITCH-B carry-forward: `evidence/SF-M05-STITCH-B/RESIDUALS.md`
- Reservation: `original_case_command` — CMP-015 remains authoritative; no direct mutation; do not redesign appeal/CMP-015 command boundary
- SF-M05-009 action: **host adapt only** via `createAppealHandler`. **Did not** modify `services/cmp-028-appeal-review/**` or CMP-015. **Did not** waive.

## Mechanical / host residuals

- Admit `@serviceform/cmp-015-application-case`, `@serviceform/cmp-017-work-queue-tasks`, `@serviceform/cmp-018-inspection-verification`, `@serviceform/cmp-019-deficiency`, `@serviceform/cmp-027-grievance-feedback`, `@serviceform/cmp-028-appeal-review`, `@serviceform/cmp-029-sla-escalation` on `apps/api/package.json` + regenerate `pnpm-lock.yaml` (orchestrator stitch). File-URL fallback can then be removed.
- Default process entry still does not auto-wire DB/OPA; tests supply doubles.
- Local builder VM had no PostgreSQL; `db:test` / M01 envelope deferred to exact-head CI.
- Independent SF-M05-INT / SF-M05-SEC / SF-M05-EVD not started (INT_OFF / SEC_OFF / EVD_OFF).
- M06 / M08 remain OFF.
