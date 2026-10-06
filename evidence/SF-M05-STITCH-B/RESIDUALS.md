# Residuals (not certification) — SF-M05-STITCH-B

## Carried forward GOVERNING / UNRESOLVED / UNWAIVED (STITCH-B cannot waive)

### CMP-019 (SF-M05-006 / PR #97 @ `b36715f83c1c2aaa47c6d9b54c568959c131db50`)

Governing store record: `/cursor/stores/self/docs/m05-006-cmp019.md`.

Material residual carried: post-commit reconciliation obligation for CMP-015 commands, CMP-029 SLA pause/resume, notification/retry, durable/idempotent recovery. `case_expected_state`|`version` not in event payload / INT-009 + EVD must prove. **INT/EVD later.** STITCH-B does **not** resolve or waive.

### CMP-028 (SF-M05-008 / PR #100 @ `1a6a1ee2e128b1c0eda8fe411d798287063eed5b`)

Governing store record: `/cursor/stores/self/docs/m05-008-cmp028.md`.

Reservation carried: `original_case_command` — CMP-015 remains authoritative; no direct mutation; do not redesign appeal/CMP-015 command boundary. **UNRESOLVED / UNWAIVED.**

## Mechanical / environmental residuals

- `@swc/core@1.16.12` install scripts ignored by root `onlyBuiltDependencies` (read-only).
- Isolated builder evidence path `evidence/SF-M05-006/**` is written by CMP-019 vitest config; stitch copied junit into `evidence/SF-M05-STITCH-B/junit/cmp-019/` and did not commit the builder path.
- Platform outbox/inbox tables (`*_event_platform`) remain non-RLS per frozen SF-CON-OUTBOX template (same pattern as Wave A).
- Builder PRs #99/#97/#98/#100 were **not** merged or mutated.
- SF-M05-009 / INT / SEC / EVD / M06 / M08 remain **OFF**.
- This stitch is **not** CERTIFIED, not G4, not G6, not self-certified. Do not merge until exact-candidate-head CI + Security + Developer-platform are SUCCESS and a separate independent STITCH-B candidate review / merge-authorization accepts.
