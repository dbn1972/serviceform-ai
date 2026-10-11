# SF-M05-INT — independent M05 integration evidence

Independent verifier disposition: **`SF_M05_INT` + `_` + `BLOCKED`** (`SF_M05_INT_BLOCKED`).

**`CROSS_TENANT_LEAKAGE=0`** · **Frozen contracts: 19/19 MATCH** · **`production_code_modified=false`**

Not CERTIFIED. Not G4. Not G6. SEC not consumed. EVD OFF. Draft PR only — do not merge. CMP-019 / CMP-028 residuals **not waived**.

| Field | Value |
|---|---|
| Task | SF-M05-INT |
| Verifier | Independent integration stitcher (INT lane only) |
| Execution base (`origin/main`) | `c0d25b32114779ddb4cc23e4e62a25f9d1365192` |
| Planning YAML `base_commit` | provenance only (`b286ed95_6755b936…`) — **not** rewritten |
| Verifier branch | `cursor/m05-int-c0d25b32` |
| Command | `bash tests/integration/m05/run.sh` |
| Local run id | `local-m05-int` / job `independent-m05-integration` |
| Components | CMP-015, CMP-016, CMP-017, CMP-018, CMP-019, CMP-027, CMP-028, CMP-029 + M05 host |
| Integration IDs | INT-004, INT-005, INT-006, INT-009 (owned); INT-011, INT-013 (re-verify) |
| SF-M05-SEC | not consumed |

## Environment

PostgreSQL 16.15 local disposable `serviceform_test` (credentials not recorded). Node 22 / pnpm 10.28.0. `pnpm install --frozen-lockfile` on execution base.

## Executed suites (12/12 PASS harness)

| Suite | Result | Tests (log) |
|---|---|---|
| Frozen contracts lock | PASS | 19/19 MATCH |
| Independent unit (INT-004/005/006/009/011/013 + host packaging) | PASS | 24 |
| Host `apps/api/test/composition-m05.test.ts` | PASS | 13 |
| CMP-015 envelope int | PASS | 27 |
| CMP-016 envelope int | PASS | 21 |
| CMP-017 envelope int | PASS | 21 |
| CMP-018 envelope int | PASS | 11 |
| CMP-019 envelope int | PASS | 5 |
| CMP-027 envelope int | PASS | 12 |
| CMP-028 envelope int | PASS | 10 |
| CMP-029 envelope int | PASS | 16 |
| Independent int (INT-011 RLS catalog) | PASS | 3 |
| **Totals** | **12/12 suites PASS** | **163 executed tests** |

Machine summary: `summary.json`. Cross-tenant: `summary/cross-tenant.json`.

## INT outcomes

| ID | Status | Notes |
|---|---|---|
| INT-004 | PASS | Domain txn refuses outbound; outbox-before-Temporal ordering |
| INT-005 | PASS | `assertCommitted` refuse pre-commit Temporal; OPA/authz on CMP-016/017; no CMP-016 HTTP |
| INT-006 | PASS | CMP-018 DigiLocker SIMULATED + PRODUCTION critical fail-closed; OCR/evidence ports |
| INT-009 | **BLOCKED** | Happy-path pause/resume ports wired; **material durable reconciliation of `case_expected_state`/`version` cannot be proven** — tokens absent from outbox event data and `deficiency_notice` columns; afterCommit swallows CMP-015/CMP-029 failures. See `INT-009/int-009-durable.json`. Do not patch. |
| INT-011 | PASS | Host forged `X-Tenant-ID` not authoritative; FORCE RLS catalog; T2 hide; `CROSS_TENANT_LEAKAGE=0` |
| INT-013 | PASS | CMP-015/018/027 + CMP-011 DigiLocker SIMULATED PRODUCTION fail-closed |

## Blocking residuals (carried, unwaived)

1. **INT-009 material** → overall **`SF_M05_INT_BLOCKED`**
2. **`M05_HOST_PACKAGE_ADMISSION_BLOCKING=true`** — `apps/api/package.json` lacks seven M05 `workspace:*` deps; file-URL fallback only. Deployable package admission needs writes outside INT set (`apps/api/package.json`, `pnpm-lock.yaml`). See `HOST/host-package-admission.json`.
3. **CMP-019** `GOVERNING_UNRESOLVED_UNWAIVED` (not waived)
4. **CMP-028** `GOVERNING_UNRESOLVED_UNWAIVED` (not waived)

## Explicit non-claims

- Not VERIFIED / Not CERTIFIED / Not G4 / Not G6
- Do not merge this PR to `main` from this evidence alone
- SEC / EVD remain independent; EVD remains OFF until both INT and SEC complete
- M06 / M08 remain OFF
- Production code not patched to force green
