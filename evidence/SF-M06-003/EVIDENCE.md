# SF-M06-003 — CMP-026 Communication / Messaging: builder evidence

Builder evidence only. **Not CERTIFIED. No G3 / G6. No self-certification.** Gate status is for
human/CI to decide. Recommended next step: `INDEPENDENT_CG_02_WAVE_A_BUILDER_REVIEW`.

| Field | Value |
|---|---|
| Authorization | `HUMAN_CG_02_WAVE_A_DISPATCH_AUTHORIZATION` (lane SF-M06-003 only) |
| Dispatch base | `8b1c26ceb1fd781eab55a34fdc17d376dcc03c1b` (`origin/main` verified equal at dispatch) |
| Branch / PR | `agent/M06-messaging-SF-M06-003` / [#117](https://github.com/dbn1972/serviceform-ai/pull/117) (DRAFT, do not merge) |
| Tested code SHA | `logs/code-sha.txt` (all logs below were produced on this tree; later commits touch only `evidence/SF-M06-003/**` and `orchestrator/handovers/SF-M06-003.yaml`) |
| Builder model / effort | claude-sonnet-5-5 / high (per envelope `model_route`) |
| Component / INT | CMP-026; INT-011 (tenant isolation), INT-013 (SIMULATED port markers) |
| Frozen contracts consumed | 24 envelope locks incl. `SF-CON-MESSAGE-THREAD`; none altered |

## Pre-dispatch guard (all PASS before branching)

| Check | Result |
|---|---|
| `origin/main == 8b1c26ce…` | PASS (fetched; commit exists) |
| Envelope `orchestrator/tasks/SF-M06-003.yaml`: READY, `implementation_authorized: true`, `dispatched: false`, `wave_eligible_now: true` | PASS |
| Contracts lock 29/29 FROZEN MATCH | PASS (`scripts/gates/contracts_lock_gate.py`, see `logs/repo-gates.log`) |
| Write-path uniqueness | PASS (`cg01_path_uniqueness_gate.py` unchanged and passing; by inspection `services/cmp-026-communication-messaging/**` appears only as a read-only path in SF-M06-001/002 and as an allowed write path only in SF-M06-003) |
| PRs #107 / #108 / #109 unmerged | PASS (all OPEN at heads `59ddddd…`, `d1614d7…`, `8b270be…`) |

## Executed checks (logs under `logs/`, JUnit under `junit/`)

| Check | Result | Log |
|---|---|---|
| `tsc --noEmit` (service tsconfig, strict + exactOptionalPropertyTypes) | exit 0 | `typecheck.log` |
| `eslint --max-warnings=0` (repo config, incl. interpolated-SQL ban) | exit 0 | `lint.log` |
| `prettier --check` | exit 0 | `format.log` |
| Unit + contract tests (6 files, 85 tests) | 85 passed | `unit-contract-coverage.log`, `junit/unit-contract.xml` |
| Service coverage (unit+contract only) | stmts 95.99 %, branches 91.03 %, lines 98.27 % | same |
| Integration on PostgreSQL 16.15 (3 files, 30 tests) | 30 passed | `integration-postgres.log`, `junit/integration.xml`, `postgres-version.txt` |
| Repo gates `run_all.py` | 10/10 PASS | `repo-gates.log` |
| `migration_lint.py` (inside gates) | 0 errors | `repo-gates.log` |
| dependency-cruiser on the service | no violations | `depcruise.log` |
| `check_scope.py --envelope SF-M06-003 --base origin/main` | PASS, 42 files, 0 errors | `check-scope.log` |
| Semgrep (same rule packs as CI: p/default, p/typescript, p/nodejsscan, p/secrets, `.semgrep/`) on the service | 0 findings (0 blocking) | `semgrep-local.log`, `semgrep-local-results.json` |
| Root `vitest run --coverage` (global thresholds incl. this service) | exit 0 | `root-unit-coverage.log` |
| Diff vs dispatch base for `contracts/**`, `orchestrator/contracts-lock.yaml`, `pnpm-lock.yaml`, `apps/**`, `specs/**`, `policy/**`, `infra/**` | empty | `frozen-readonly-diff-stat.log` |

### Lockfile residual (expected, not fixed here)

`pnpm install --frozen-lockfile` locally rewrites the lockfile to add the single importer line
`services/cmp-026-communication-messaging: {}` (plus two whitespace-only hunks that are unrelated
formatting drift on `main`). `pnpm-lock.yaml` was reverted and is **not** part of this change:
`EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL` (`logs/lockfile-residual.diff`). `package.json`
declares no dependencies.

## Security correction (HUMAN_CG_02_WAVE_A_SECURITY_CORRECTION_AUTHORIZATION)

Independent review blocked the first candidate (`9ac8f9bb…`) on CI **SAST (semgrep)**: two
`ajinabraham.njsscan.dos.regex_dos` blocking findings in `src/domain/model.ts` (storage-key
regex line 96, `^\d{1,15}$` sequence regex line 175). Correction, no suppressions or rule/workflow
edits:

- `parseStorageKey`: length bound 8..256 first, then one linear per-character pass over
  `[A-Za-z0-9_./:-]`; traversal (`..`, leading `/`, `//`) refusals unchanged. `STORAGE_KEY_RE`
  removed from `validate.ts` (no remaining users).
- `parseSequence`: length bound 1..15 first, then ASCII-digit loop (same accepted set as before).
- `isIsoTimestamp` (`validate.ts`): defensive 64-character bound before the `T.*` pattern.
- New tests: boundary and hostile-input cases (7/8/256/257 chars, 16 digits, unicode digits,
  control characters, multi-megabyte inputs complete in < 1 s).
- Reproduced locally before the fix (2 findings at the same lines) and after (0 findings) with the
  CI command; see `semgrep-local.log`. Delta vs previous head: `security-correction-delta.txt`.

## Requirement trace

| Requirement | Implementation | Executed proof |
|---|---|---|
| Tenant-scoped threads, no cross-tenant participants | `thread`/`participant` carry `tenant_id`; composite tenant FKs; participant `tenant_id` must equal context or request fails `SF-TEN-002`; contract document built with the thread tenant only | `service.test.ts` "refuses a participant that names another tenant"; `frozen-contracts.test.ts` document validates against frozen schema; `privilege-rls.int.test.ts` cross-tenant participant/FK negatives |
| FORCE RLS on every tenant table | migration `ENABLE`+`FORCE`, owner `sf_migrator`, runtime inherits `sf_app`+`sf_cmp026_rw` only | `privilege-rls.int.test.ts` (role flags, relrowsecurity/relforcerowsecurity, wrong tenant invisible, no tenant context sees 0 rows, peer role denied, `sf_app` alone denied, no DELETE/TRUNCATE); `frozen-contracts.test.ts` migration text assertions |
| OPA fail-closed | `authorizeAction`: error → 503, deny/malformed → 403, before any write | `service.test.ts` OPA deny / PDP failure / per-operation deny; `txCount === 0` on PDP failure |
| No cross-case leakage / no existence oracle | non-participants, removed participants and other tenants get the same 404 | `service.test.ts` outsiders; `service-flow.int.test.ts` other tenant + same-tenant outsider |
| Attachments via CMP-032 ports only, no object-store ownership | `AttachmentStoragePort`; keys stored as references; scan verdict must be `CLEAN`; no storage credentials/SDK | `service.test.ts` attachments block (unknown, other-tenant, pending, infected, malformed, traversal, duplicate, outage, unconfigured port); DB check constraints in `privilege-rls.int.test.ts` |
| No network inside authoritative DB transaction | `guardOutboundPort` + `runInDomainTransaction`; ports are called before/after the DB transaction | `service.test.ts` "never calls an outbound port while a domain transaction is open" and the refusal test |
| Immutable official notices; UI delete never erases audit | append-only triggers; retraction is a tombstone row; notices cannot be retracted | `service.test.ts` retraction + notice immutability; `privilege-rls.int.test.ts` (UPDATE/DELETE refused, row survives); `service-flow.int.test.ts` |
| Acknowledgement / due dates | `ack_required`, caller-supplied `ack_due_at` (no statutory computation); one ack per participant; sender cannot ack | `service.test.ts` notice block; DB trigger tests |
| Idempotency / exactly-once visible effect | `Idempotency-Key` + fingerprint on every mutating call | replay tests; `service-flow.int.test.ts` concurrent duplicate keys → one message |
| Gap-free ordering under concurrency | thread row lock + `message_seq` trigger | `service-flow.int.test.ts` 12 concurrent senders → sequences 1..12 |
| Outbox + audit atomic with state; no body/PII in events | `insertOutbox` inside the transaction; events carry opaque refs + digest | `service-flow.int.test.ts` crash-rollback test and canary-body test; `service.test.ts` events test |
| Frozen contracts consumed unchanged | contract test hashes `message-thread.schema.json` against `orchestrator/contracts-lock.yaml` | `frozen-contracts.test.ts` |
| No named-service/department/tenant branching | generic metadata inputs only | `no-named-branching.test.ts`; `hardcoding_gate.py` PASS |
| SIMULATED connectors never in production | `assertPortAllowed` at construction | `http.test.ts` (PRODUCTION/UAT/PREPROD refused) |

## Observations for the independent reviewer (no CCR required)

1. `SF-CON-MESSAGE-THREAD` cannot express "every `participants[].tenant_id` equals the thread's
   `tenant_id`" in JSON Schema; CMP-026 enforces it in service code and by tenant-composite FKs +
   RLS, and the frozen invalid example (`cross_tenant_participants_forbidden: false`) is rejected.
2. The OPA policy bundle (`policy/**` is read-only for this lane) is not authored here. Actions the
   service asks for: `THREAD_OPEN`, `THREAD_LIST`, `THREAD_READ`, `THREAD_CLOSE`, `THREAD_REOPEN`,
   `THREAD_ARCHIVE`, `PARTICIPANT_ADD`, `PARTICIPANT_REMOVE`, `MESSAGE_SEND`, `NOTICE_SEND`,
   `MESSAGE_READ`, `MESSAGE_RETRACT`, `NOTICE_ACKNOWLEDGE`, `READ_RECEIPT_MARK`, `ATTACHMENT_ACCESS`.
3. Real CMP-032 / CMP-004 / CMP-015 adapters and host wiring are out of scope (host = SF-M06-005,
   INT/SEC later). Only SIMULATED adapters exist, refused outside LOCAL/CI/DEVELOPMENT/SIT/PERFORMANCE.
4. Not implemented (outside this lane or unspecified policy): content moderation, cryptographic
   signing of official notices, archival/retention (CMP-049 is held for statutory input), channel
   fanout itself (CMP-025 consumes `CaseMessageSent` from the outbox).
5. Migration prefix `1759542600000/1` is unique on the dispatch base; the independent reviewer should
   confirm no sibling Wave A lane chose the same prefix when the PRs are compared.
6. A real defect was found and fixed during self-test: PostgreSQL regex repetition is limited to
   255, so `{8,256}` was invalid in the attachment `storage_key` CHECK; replaced with
   `char_length` + character-class checks (covered by an integration negative).
7. No load, soak, resilience, backup/restore or real-connector evidence exists for this lane; those
   belong to later independent gates.

## Recommended gate state (proposal only)

Builder candidate ready for independent builder review. Not VERIFIED, not CERTIFIED.
