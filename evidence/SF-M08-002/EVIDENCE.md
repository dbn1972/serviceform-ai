# SF-M08-002 evidence (CMP-007 Recommendation Engine)

Builder evidence only. **NON_AUTHORITATIVE. DRAFT. Not VERIFIED. Not CERTIFIED. Not G3. Not G6.** Do not merge.

| Field | Value |
|---|---|
| Task | SF-M08-002 (CG-02 Wave A) |
| Component | CMP-007 |
| Authorization | `HUMAN_CG_02_WAVE_A_DISPATCH_AUTHORIZATION = true` |
| Dispatch base | `8b1c26ceb1fd781eab55a34fdc17d376dcc03c1b` (== `origin/main` at dispatch) |
| Branch / PR | `agent/M08-recommendation-SF-M08-002` / https://github.com/dbn1972/serviceform-ai/pull/115 (draft) |
| Code commit (pre-handover) | `ebc3ed0b3e9d5fd2f6c40410d6a9ea0ecf2cd799` |
| Model route | sonnet / `claude-sonnet-5-5` / effort high (recorded, not evidence of quality) |
| CCR | false; frozen contracts and `orchestrator/contracts-lock.yaml` untouched (29/29 MATCH) |
| Lockfile | `pnpm-lock.yaml` not modified (`EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL`) |

## Pre-dispatch guard (executed)

`origin/main == 8b1c26ce…`; own envelope READY / `implementation_authorized=true` / `dispatched=false` /
`wave_eligible_now=true`; `cg01_path_uniqueness_gate.py` PASS; `contracts_lock_gate.py` 29 FROZEN PASS;
#107 / #108 / #109 OPEN at `59ddddd4…` / `d1614d70…` / `8b270beb…` (unmerged, unchanged).

## Local executed checks (PostgreSQL 16.15 on this VM)

| Check | Result | Log |
|---|---|---|
| `tsc --noEmit` (service) | PASS | `logs/typecheck.log` |
| ESLint `--max-warnings=0`, Prettier check | PASS | `logs/eslint.log`, `logs/prettier.log` |
| Unit + contract tests | 61/61 PASS (3 files) | `logs/unit-contract.log`, `junit/unit.xml` |
| PostgreSQL integration (privilege/FORCE RLS/API) | 9/9 PASS | `logs/integration-postgres16.log`, `junit/integration.xml` |
| `pnpm db:test` (all migrations incl. CMP-007) | 17/17 PASS | `logs/db-test.log` |
| Migration down then up | PASS (schema dropped, recreated) | n/a (interactive) |
| `scripts/gates/run_all.py` | 10/10 PASS | `logs/gates.log` |
| `migration_lint.py` | PASS | `logs/migration-lint.log` |
| `check_scope.py` vs `orchestrator/tasks/SF-M08-002.yaml` | PASS | `logs/check-scope.log` |

## What the tests prove

- Models only via CMP-039: static test forbids provider SDK/host/`fetch`; every port call is behind the
  `external()` no-network-in-transaction guard (unit + static test); gateway never called in a transaction.
- NON_AUTHORITATIVE: API/events/rows carry `non_authoritative=true`, `authoritative=false`,
  `statutory_decision=false`; DB CHECKs and a transition trigger refuse anything else (int test).
- Closed output parser: free text, extra keys, invented candidates, unpinned reason codes, authoritative
  flags and binding-decision phrasing are refused as `UNSAFE_OUTPUT`; nothing authoritative is stored.
- Policy refuses reason/signal/purpose codes naming eligibility/approval/penalty/fee/payment outcomes.
- Consent/purpose checked first and fail closed (missing, withdrawn, other tenant, service down).
- Tenant isolation: server-derived tenant, tenant headers refused, FORCE RLS, `CROSS_TENANT_LEAKAGE=0`
  (canary), cross-tenant and non-owner reads are 404, OPA deny and PDP outage fail closed.
- Idempotent create (replay, conflict, stored failure replay); outbox + audit in the same transaction.
- Frozen SF-CON-RECOMMENDATION validated with Ajv against `contracts/m08/schemas` (valid and invalid examples).
- Outbox migration equals the frozen SF-CON-OUTBOX template after substitution.

## Exact-head CI on `ebc3ed0b…` (pre-handover)

ci [38015563191](https://github.com/dbn1972/serviceform-ai/actions/runs/38015563191),
security [38015563131](https://github.com/dbn1972/serviceform-ai/actions/runs/38015563131),
developer-platform [38015563188](https://github.com/dbn1972/serviceform-ai/actions/runs/38015563188).
architecture gates, SAST (semgrep), CodeQL, gitleaks, checkov, workflow validation, flutter: SUCCESS.
Every failing job failed **only** at `pnpm install --frozen-lockfile` with
`ERR_PNPM_OUTDATED_LOCKFILE` for the new importer `services/cmp-007-recommendation`
(`EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL`); jobs that need installed dependencies therefore did
not execute in CI and are covered by the local runs above. Frozen-lockfile CI was not weakened.

## Not done (out of scope / held)

Host mount (SF-M08-007), real port adapters, SF-M08-005, STITCH-A, Wave B, INT/SEC/EVD, M07+. No claim
of VERIFIED, CERTIFIED, G3 or G6; independent review is required.
