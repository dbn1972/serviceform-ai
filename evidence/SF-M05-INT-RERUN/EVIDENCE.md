# SF-M05-INT-RERUN — independent M05 integration (LOCK-8 post-remediation)

**Draft unmerged verifier evidence. Not CERTIFIED. Not G4. Not G6. Not EVD.**
Production code **not** modified. Did **not** reuse PR #103. CMP-019 / CMP-028 residuals **not waived**.

| Field | Value |
|---|---|
| Task | SF-M05-INT-RERUN |
| Authorization | `HUMAN_SF_M05_LOCK8_RERUN_AUTHORIZATION` |
| SHA guard | `origin/main` = `4d99c91e4bcdc145585fe62449c83a004de1399d` |
| Branch | `cursor/m05-int-rerun-4d99c91e` |
| Write set | `tests/integration/m05/**`, `evidence/SF-M05-INT-RERUN/**`, `orchestrator/handovers/SF-M05-INT-RERUN.yaml` |
| Result | **`SF_M05_INT_RERUN_PASS`** |

## Local executed evidence

Command: `bash tests/integration/m05/run.sh` (`local-m05-int-rerun`).

| Metric | Value |
|---|---|
| Suites | **12/12 PASS** |
| `CROSS_TENANT_LEAKAGE` | **0** |
| Contracts | **19/19 MATCH** |
| INT-004 | PASS |
| INT-005 | PASS |
| INT-006 | PASS |
| INT-009 | **PASS** (`INT_009_DURABLE_RECONCILIATION=PROVEN`) |
| INT-011 | PASS (`M05_HOST_PACKAGE_ADMISSION=ADMITTED`) |
| INT-013 | PASS |

## INT-009 CRITICAL (REM-001)

Executable E2E (not static inspection) against production `DeficiencyReconciliationConsumer` + PostgreSQL:

- OPEN/RESPOND healthy; durable `reconciliation_intent` tokens
- CMP-015 / CMP-029 fail → reconcile; both fail → recover
- Crash after commit / after first effect; duplicate delivery; replay no-op
- **`STALE_EXPECTED_STATE` → `FAILED_STALE`** (terminal, not retryable)
- **`STALE_VERSION` → `FAILED_STALE`** (terminal)
- Reconstruct from durable state; T1≠T2; FORCE RLS; CROSS_TENANT_LEAKAGE=0
- CaseCommandPort / SlaClockPort only; no cross-component SQL; no network in auth txn

Artifacts: `INT-009/int-009-durable.json`.

CMP-019 residual remains **GOVERNING_UNRESOLVED_UNWAIVED**. Verifier may recommend **`RESIDUAL_CLOSURE_RECOMMENDED`** only because INT-009 fully passed — verifier does **not** waive.

## INT-011 seven package admissions (REM-002)

Exactly seven `@serviceform/api` `workspace:*` deps resolve/load by package specifier (no composition `.ts` file-URL required). CMP-016 none. CMP-036 single. `M05_HOST_PACKAGE_ADMISSION=ADMITTED`.

Artifact: `HOST/host-package-admission.json`.

## CMP-028 revalidate

CMP-028 envelope integration re-executed. Residual remains **GOVERNING_UNRESOLVED_UNWAIVED** (not silently waived).

## Explicit non-claims

- Not CERTIFIED / Not G4 / Not G6 / Not self-certified
- Do not merge this PR
- Did not start SEC / EVD / M06 / M08
- Did not consume SEC unmerged branch
- Did not waive CMP-019 or CMP-028
- Did not reuse #103 as PASS evidence
