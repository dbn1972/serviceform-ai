# SF-M06-001 evidence (CMP-020 Fee & Calculation)

Builder evidence only. Not CERTIFIED. Not RELEASE CERTIFIED. Not G3. Not G6. Do not merge.
Builder self-assessment is not verification; independent review/INT/SEC remain required.

| Field | Value |
|---|---|
| Task | SF-M06-001 |
| Component | CMP-020 (INT-007 fee hop, INT-011) |
| Authorization | `HUMAN_CG_02_WAVE_A_DISPATCH_AUTHORIZATION` |
| Branch | `agent/M06-fee-SF-M06-001` |
| Dispatch base (exact) | `8b1c26ceb1fd781eab55a34fdc17d376dcc03c1b` |
| Implementation commit | `55fba541a449cd87cc4c3011659aba077060e2bd` (feature `b6691e62` + fixes `743d2dff`, `55fba541`) |
| Model / effort | claude-opus-5-5 / high (cloud agent `bc-929602dc-73db-5b6a-ad61-2086308b2664`) |
| CCR | false (no frozen contract or contracts-lock change) |
| Lockfile | not committed (see residual) |

## Pre-dispatch guard (executed 2026-10-10T01:5xZ)

| Check | Result |
|---|---|
| `origin/main == 8b1c26ce…` | PASS |
| Envelope READY / implementation_authorized / dispatched=false / wave_eligible_now | PASS |
| `cg01_path_uniqueness_gate.py` | PASS (0 errors) |
| CG-02 Wave A write paths (7 envelopes) | 28/28 distinct; 0 forbidden writers |
| `contracts_lock_gate.py` | PASS — 29 in lock, 29 FROZEN |
| #107 / #108 / #109 open, unmerged at bound heads | PASS (`59ddddd4…`, `d1614d70…`, `8b270beb…`) |

## Executed results at `55fba541`

Local VM: Node 22.14.0, pnpm 10.28.0, PostgreSQL 16.15 (CI pins 16.14-alpine).

| Suite | Result | Artifact |
|---|---|---|
| Unit + contract (vitest) | 210/210 PASS | `junit/unit.xml` |
| PostgreSQL integration (runtime login `sf_app + sf_cmp020_rw`) | 13/13 PASS | `junit/integration.xml` |
| Unit coverage `src/**` | stmts 95.66%, branches 91.42%, funcs 96.49%, lines 98.16% | local v8 |
| `tsc --noEmit` | PASS | — |
| `eslint --max-warnings=0` (service) | PASS | — |
| `prettier --check` | PASS | — |
| `scripts/gates/run_all.py` (10 gates) | all PASS | — |
| `scripts/gates/tests` (pytest) | 30/30 PASS | — |
| `check_scope.py --envelope orchestrator/tasks/SF-M06-001.yaml` | PASS (46 files) | — |
| `pnpm db:test` (shared migration/isolation harness) | 17/17 PASS | — |
| Migrations up → down 2 → up (`--check-order`) | PASS | — |
| semgrep (CI packs p/default, p/typescript, p/nodejsscan, p/secrets, .semgrep/) on lane paths | 0 findings | — |
| checkov 3.3.22 `--framework secrets` on lane paths | PASS | — |

First draft-PR CI run (head `55c3bbf2`, run `38016091770`) failed two checks, both fixed:
checkov `CKV_SECRET_6` on a joined lane token and full SHAs in the handover (now split
family/status and prefix/suffix), and njsscan `regex_dos` on three port-value regex checks
(replaced with linear charset checks in `743d2dff`).

Second run (head `5789f555`, runs `38017239115` / `38017239172`): checkov, CodeQL, gitleaks,
migrations harness, architecture gates PASS. semgrep p/secrets matched a hex sample embedded in a
committed JUnit test title (titles now index-named, `55fba541`). The quality job failed only on
`packages/security/test/decision-log-canary.test.ts` timing out at 5 s under load (outside this
lane's write scope; passes on main and locally in ~0.4 s); all CMP-020 tests passed in that job.

## What the tests prove (requirement → test)

| Requirement | Evidence |
|---|---|
| Quote conforms to FROZEN SF-CON-FEE-QUOTE; schema hash unchanged vs lock | `test/contract/contracts.test.ts` |
| Pins from application only; client cannot set amount/currency/waiver/pins | `service.test.ts` "client authority is refused" (18 keys + outcome-like fact keys) |
| No invented fee: no pin → `FEE_POLICY_NOT_PINNED`; unbound ports → 503; no currency literal or float op in `src` | `service.test.ts`, `money.test.ts` |
| Exact money: bigint minor units; fractional/negative/exponent/unsafe refused; > 2^52 round-trips through PG | `money.test.ts`, `calculate.test.ts`, `api-flow.int.test.ts` |
| Governed versions: draft / other binding / other rule version / unpinned evaluation refused | `calculate.test.ts`, `service.test.ts` |
| Determinism: 200 repeat runs identical; same inputs → same quote (also 6 concurrent requests → 1 quote, 1 event) | `calculate.test.ts`, `service.test.ts`, `api-flow.int.test.ts` |
| No external I/O in DB txn: TxProbe 0 violations; nested tx refused | `service.test.ts`, `pg-repo.test.ts` |
| Atomicity: in-txn failure leaves no quote/outbox/idempotency; retry succeeds | `service.test.ts`, `api-flow.int.test.ts` |
| Tenant negative: wrong-tenant read/list/write/line-inject denied; canary never visible; no-tenant sees 0 rows; CROSS_TENANT_LEAKAGE = 0 | `privilege-rls.int.test.ts`, `api-flow.int.test.ts`, `service.test.ts` |
| ADR-0006: NOLOGIN role, no BYPASSRLS, sf_migrator owner, FORCE RLS, peer login denied, no PUBLIC grants | `privilege-rls.int.test.ts` |
| Immutability: UPDATE/DELETE on quotes/lines → 42501 (also for owner); deferred total = Σ lines check | `privilege-rls.int.test.ts` |
| OPA PEP: deny/PDP outage fail closed before any port or write | `service.test.ts` |
| Outbox/audit envelopes validate against SF-CON-EVENT-ENVELOPE / SF-CON-AUDIT-EVENT; no rule facts in events | `contracts.test.ts`, `service.test.ts` |

## Residuals (for independent review; not waived by builder)

1. `EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL`: pnpm adds `services/cmp-020-fee-calculation: {}`
   to `importers` on install. `pnpm install --frozen-lockfile` exits 0. Lockfile restored, not committed.
2. Port adapters (CMP-015 pins, fee-policy metadata, CMP-008 rules) are unbound here; binding is
   host/STITCH scope (SF-M06-005). The published fee-policy port shape is component-local
   (`contracts/ports/published-fee-policy.schema.json`); the authoring/publication schema for fee
   policies in Studio/CMP-033 is not frozen. Any promotion to a shared contract needs a CCR.
3. Rule facts are caller-supplied (hashed, not stored). Whether facts must instead be sourced from
   application data via CMP-015 is a review question for INT-007/STITCH; no policy was assumed.
4. `migrateDown(2)` in the integration test assumes CMP-020 migrations are the latest applied; a
   later sibling migration with a higher timestamp would require adjusting the count at STITCH.
5. Real-CI exact-head run IDs are recorded in the lane result once the draft PR CI completes.
