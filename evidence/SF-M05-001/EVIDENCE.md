# SF-M05-001 evidence — CMP-015 Application / Case Management (Wave A builder)

**Not CERTIFIED. Not VERIFIED. Not G4. Not G6.** Builder self-certification is false. **DO NOT MERGE.**
Executed locally by the builder; CI has **not** run because GitHub returned 401 for `git push` and `gh`.

| Field | Value |
|---|---|
| Task / component | SF-M05-001 / CMP-015 |
| Integrations | INT-004, INT-005 (post-commit signal port only), INT-011 |
| Branch | `agent/M05-case-SF-M05-001` |
| Authorized base | `6e9f0481eb3007dedee5580838cab59ceea66f03` (equal to `origin/main` at dispatch) |
| Code commits | `7de6a0f` migrations, `6edd2e0` service (evidence commit follows) |
| Frozen contracts | 19/19 MATCH; `contracts/**`, `orchestrator/contracts-lock.yaml`, `pnpm-lock.yaml` diff = 0 lines |
| CCR required | false |
| Builder model | claude-opus-5-5 (high), Cursor cloud agent |
| Runtime | Node 22.14.0, pnpm 10.28.0, PostgreSQL 16.15 (local cluster; CI pins 16.14) |

## Scope delivered

- `db/migrations/1759540150000_cmp-015-application-case.sql`: schema `sf_application_case` (owner `sf_migrator`),
  NOLOGIN `sf_cmp015_rw`, FORCE RLS on all TENANT_SCOPED tables via `sf_platform.current_tenant_id()`, PUBLIC revoked,
  no SUPERUSER/BYPASSRLS. Tables `application_case`, `case_request_reference`, `case_transition`, `idempotency_record`.
  Triggers: frozen transition table, +1 version, immutable pins/identity, committed+consumed request required for
  WITHDRAWN/CANCELLED, append-only transitions, no delete. State CHECK excludes `*_REQUESTED`.
- `db/migrations/1759540150001_cmp-015-outbox.sql`: SF-CON-OUTBOX template with `{schema}`/`{cmp}` replacement only.
- `services/cmp-015-application-case/**`: dependency-free package (frozen-lockfile passes with no lockfile change),
  domain state machine, command pipeline with commit receipts, network-I/O-in-transaction guard, pin graph + hash,
  idempotency, outbox + audit, OPA PEP (fail closed, `policy_revision` recorded per action), ADR-0003 request
  references + policy-gated WITHDRAWN/CANCELLED, AI decision boundary, payment/notification/DigiLocker ports only,
  framework-neutral routes (no `apps/api` mount; SF-M05-009).

## Results (builder-executed)

| Check | Result | Log |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS ("Lockfile is up to date"); local cosmetic rewrite restored, not committed | `logs/frozen-lockfile.log` |
| `pnpm format:check` | PASS | `logs/format.log` |
| `pnpm lint` | PASS | `logs/lint.log` |
| `pnpm typecheck` | PASS | `logs/typecheck.log` |
| `pnpm test:coverage` | PASS 168 files / 991 tests; stmt 84.77 / branch 74.07 / fn 91.04 / line 88.49 | `logs/coverage.log` |
| `pnpm contracts:validate` | PASS | `logs/contracts.log` |
| `pnpm test:cdc` | PASS | `logs/cdc.log` |
| `pnpm deps:graph` | PASS (1071 modules, 0 violations) | `logs/deps.log` |
| `pnpm build` | PASS | `logs/build.log` |
| architecture gates `run_all.py` | PASS 10/10 | `logs/gates.log` |
| gate self-tests | PASS 25 | `logs/gate-selftests.log` |
| contracts lock | PASS 19/19 FROZEN | `logs/contracts-lock.log` |
| `check_scope.py` (SF-M05-001 envelope) | PASS | `logs/scope.log` |
| `pnpm db:test` | PASS 3 files / 17 tests | `logs/dbtest.log` |
| CMP-015 unit + contract | PASS 6 files / 125 tests | `logs/unit-contract.log`, `junit/unit-contract.xml` |
| CMP-015 PostgreSQL integration | PASS 3 files / 27 tests | `logs/integration.log`, `junit/integration.xml` |

## Required negative tests (all executed, all PASS)

| Requirement | Unit (memory store) | PostgreSQL integration |
|---|---|---|
| Wrong tenant denied | `service.test.ts` tenant isolation; `http.test.ts` 404 | `service-flow` INT-011 (leak count 0); `privilege-rls` RLS |
| Stale expected_state / version rejected | `service.test.ts` (incl. race between pre-check and lock) | `service-flow` stale + 3-way concurrent race (exactly one commit) |
| Duplicate idempotency safe | replay, conflict, malformed key | sequential + concurrent same key: one transition |
| Network I/O in tx rejected | every outbound port (7) refused in tx | Temporal port in tx → rollback |
| Temporal advance before domain commit impossible | commit failure → no signal; forged/foreign receipt; gate in tx; phase order | commit failure → no signal, no state |
| `*_REQUESTED` cannot be application state | `expected_state` refused; command refused | trigger + CHECK (trigger disabled in rolled-back admin tx) |
| WITHDRAWN/CANCELLED without committed request rejected | none / SUBMITTED / UNDER_REVIEW / wrong kind / REJECTED / EXPIRED | service path + DB trigger (`SF_REQUEST_NOT_COMMITTED`) |
| AI cannot final-approve/reject | AI maker refused for any actor; INTEGRATION refused; withdrawal request decisions | service path over PostgreSQL |

Frozen-schema evidence: `test/contract/frozen-contracts.test.ts` validates emitted SM records (all 39 transitions),
command-transition records, version-pinning records, every outbox envelope, audit events, OPA inputs and error bodies
with Ajv 2020 against `contracts/**` (read-only), and checks the migration CHECK/trigger tables, isolation
declarations and outbox template against the frozen contracts.

## Security / tenant isolation

| Flag | Value |
|---|---|
| CROSS_TENANT_LEAKAGE | 0 (service + direct SQL as runtime login) |
| Runtime login | `sf_app` + `sf_cmp015_rw` only; not SUPERUSER, not BYPASSRLS, not owner, no CREATE |
| Peer component login | SELECT/INSERT/UPDATE/DELETE denied; `SET ROLE` into peer role denied |
| `sf_app` alone | no DML/SELECT on CMP-015 authoritative tables |
| Cross-component SQL | none (migration references only `sf_application_case` and `sf_platform`) |
| PII / secrets in evidence | none (checked) |

## Not done / residuals

- **CI not run**: GitHub 401 on push and `gh`. No CI / Security / Developer-platform run IDs exist. Branch delivered as a
  git bundle by the builder. Exact-head CI must be executed after the branch is pushed by an authenticated principal.
- Host mount (SF-M05-009), real OPA/binding/policy/Temporal adapters, governed re-pin (Constitution #35), assisted
  service (INT-015), READ audit — out of this slice.
- STITCH-A owns the lockfile importer for this package if a future change adds dependencies.
