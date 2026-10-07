# CMP-019 Deficiency / Clarification Service

Reusable deficiency notices, requested items, citizen responses, evidence refs, due dates,
resolution/closure, audit and idempotency (Eng v1.4 CMP-019, INT-009).

Status: SF-M05-006 builder output. Not CERTIFIED, not G4, not G6. Host mount deferred to SF-M05-009.

## Ownership (schema `sf_deficiency`, role `sf_cmp019_rw`, ADR-0006)

Authoritative deficiency state lives here. Case transitions use the CMP-015 command port. SLA
pause/resume uses the CMP-029 INT-009 port. Notification uses the M06 CMP-025 port. This package
does not write CMP-015 or CMP-029 tables and implements no SMS/email/push provider.

## Lifecycle

`OPEN` (officer) → `RESPONSE_RECEIVED` (citizen) → `CLOSED` (officer). An officer may also close an
`OPEN` notice. Time (`opened_at`, `responded_at`, `closed_at`) is server-derived. AI/SYSTEM actors
cannot open or close a deficiency.

INT-009: open/respond/close persist a same-transaction `reconciliation_intent` carrying
`case_expected_state`/`case_expected_version` and SLA pause/resume tokens. The executable
`DeficiencyReconciliationConsumer` (CMP-016-like + inbox) applies CaseCommandPort / SlaClockPort
effects after commit; `afterCommit` is best-effort only. Crash recovery uses `reconcilePending`.
CMP-019 residual remains GOVERNING_UNRESOLVED_UNWAIVED until independent INT re-proof.
