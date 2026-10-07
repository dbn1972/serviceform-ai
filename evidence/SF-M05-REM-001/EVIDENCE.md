# SF-M05-REM-001 — CMP-019 durable reconciliation (INT-009)

**DRAFT unmerged remediation. Not CERTIFIED. Not G4. Not G6.**
CMP-019 remains **GOVERNING_UNRESOLVED_UNWAIVED**.

| Field | Value |
|---|---|
| Task | SF-M05-REM-001 |
| Authorization | `HUMAN_SF_M05_LOCK8_PRODUCTION_REMEDIATION_AUTHORIZATION` |
| SHA guard | `origin/main` = `c0d25b32114779ddb4cc23e4e62a25f9d1365192` |
| Branch | `cursor/m05-rem-int009-c0d25b32` |
| Component | CMP-019 |
| Integration | INT-009 |

## Remedy summary

1. **Additive migration** `db/migrations/1759541900002_cmp-019-reconciliation.sql` creates
   `sf_deficiency.reconciliation_intent` (FORCE RLS, tenant-scoped) holding same-txn
   reconstruction tokens for CaseCommandPort (`case_expected_state` / `case_expected_version`,
   command, reason, deterministic key) and SlaClockPort (pause/resume, stage, reason, key),
   plus notification port status. SF-CON-OUTBOX table shape unchanged.
2. **Executable consumer** `DeficiencyReconciliationConsumer` (`cmp-019.reconciliation` inbox):
   committed-only, tenant-validated, CaseCommandPort / SlaClockPort only, no network in auth txn,
   idempotent duplicate delivery, partial retry of incomplete effects, stale expected version →
   `FAILED_STALE` (observable, not blindly retried), crash-after-commit recoverable via
   `reconcilePending`. Temporal not authoritative. `afterCommit` remains best-effort only.

## Local executed evidence

| Check | Result |
|---|---|
| `pnpm --filter @serviceform/cmp-019-deficiency typecheck` | PASS |
| `pnpm --filter @serviceform/cmp-019-deficiency test:unit` | **31/31 PASS** |
| JUnit | `evidence/SF-M05-REM-001/junit/unit.xml` |

Unit coverage includes: OPEN/RESPOND healthy; CMP-015 fail→reconcile; CMP-029 fail→reconcile;
both fail→recover; crash after commit; crash after first effect; duplicate delivery; replay no-op;
stale expected version; reconstruct from durable state; T1≠T2.

PostgreSQL FORCE RLS / integration suite deferred to exact-head CI (`test:integration`).

## Explicit non-claims

- Not CERTIFIED / Not G4 / Not G6 / Not self-certified
- Do not merge this PR from this evidence alone
- Did not start REM-002 / EVD / INT-SEC rerun
- CMP-019 residual **not waived**
