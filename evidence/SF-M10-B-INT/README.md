# SF-M10-B-INT — Phase B independent integration verification

| Field | Value |
|---|---|
| Task | B-7 / SF-M10-B-INT (independent integration stitcher; did not build the code under test) |
| Under test | `cursor/m10-phase-b-platform-wire-0b20` @ `f334df88053d5b39a27bd4546e04817b66280497` ([PR #211](https://github.com/dbn1972/serviceform-ai/pull/211), stacked on PR #210) |
| Verifier branch | `cursor/m10-phase-b-int-verify-0b20` (writes only `tests/integration/m10-platform/**`, `evidence/SF-M10-B-INT/**`) |
| Run | 4 Nov 2026, Cursor cloud VM. Node 22.23.4, PostgreSQL 16.15 (own cluster `intverify`, port 5435, fresh database), OPA 1.21.1 |
| Model | claude-opus-5-5 (route `opus`, per MODEL-ROUTING-QUALITY.md) |
| Stamp | SAMPLE_LAB · SIMULATED OTP/IdP · synthetic data only · **recommendation only — not CERTIFIED, no G3/G6 claim** |

## Topology exercised

Two SAMPLE_LAB platform hosts against **one** PostgreSQL and the **same** CMP-004 citizen directory
(same pepper), each with its own real OPA:

| Host | API | OPA | Placement |
|---|---|---|---|
| A | 4200 | 8381 | `fixtures/lab/platform` (tenant `…0000d1`, TSB `…0000d2`) |
| B | 4201 | 8382 | derived by `support/tenant-b.mjs` (tenant `…0000b1`, TSB `…0000b2`, distinct pins, own officer). OPA B carries **both** tenants' data, so isolation cannot come from missing policy data. |

The citizen and officer BFF route handlers (`apps/web-citizen|web-officer/app/api/portal/**`) are
imported and invoked in-process against host A (same code `next start` serves; no browser).

## Commands

```bash
sudo pg_createcluster 16 intverify -p 5435 --start
sudo -u postgres psql -p 5435 -c "CREATE ROLE ci LOGIN SUPERUSER PASSWORD '<choose-a-local-password>'" \
  -c "CREATE DATABASE sf_int OWNER ci" -c "CREATE DATABASE sf_int_comp OWNER ci"
pnpm install --frozen-lockfile

# Platform-path INT suite (brings up host A via scripts/dev/platform-lab.sh, then OPA B + host B)
DATABASE_URL=postgres://ci@localhost:5435/sf_int \
  bash tests/integration/m10-platform/run.sh

# Component integration suites on a separate database
(cd services/cmp-004-identity-access && DATABASE_URL=postgres://ci@localhost:5435/sf_int_comp \
  pnpm exec vitest run --root . --config vitest.integration.config.ts)
(cd services/cmp-015-application-case && DATABASE_URL=postgres://ci@localhost:5435/sf_int_comp \
  pnpm exec vitest run --root . --config vitest.integration.config.ts)
```

## Results

| Suite | Result | Evidence |
|---|---|---|
| `tests/integration/m10-platform` (7 files, fresh DB) | **58 passed, 4 expected-fail** (known defects, see below), 0 unexpected failures | `logs/m10-platform-int.log`, `junit/m10-platform-int.xml` |
| CMP-004 integration (`sf_int_comp`) | 8/8 passed | `logs/cmp004-integration.log`, `junit/cmp004-integration.xml` |
| CMP-015 integration (`sf_int_comp`) | 31/31 passed | `logs/cmp015-integration.log`, `junit/cmp015-integration.xml` |
| `prettier --check`, `eslint --max-warnings=0` on `tests/integration/m10-platform` | clean | — |

Known-defect tests use `it.fails`: they assert the contract-correct behaviour, currently fail, and
will turn red (forcing an update) when the owner fixes the defect.

## Per-INT results

| INT | Result | What was executed |
|---|---|---|
| **INT-001** citizen auth → profile → DigiLocker/consent | **PARTIAL — auth leg PASS** | OTP challenge → SIMULATED inbox → verify → `me` (platform-global citizen, `tenant_id: null`); wrong OTP issues no session; citizen and officer revoke invalidate `me` and CMP-015 access; BFF cookie holds only the CMP-004 opaque token and satisfies SF-CON-PORTAL-SESSION; forged base64-JSON cookies are never decoded. Profile (CMP-005) and DigiLocker/consent are not on this path (expected). |
| **INT-004** submission hot path, outbox in same txn | **PASS** | For draft, working-data write and every command: the expected domain event + audit row (none for working data values) are written with an identical PostgreSQL transaction timestamp and correlation id; envelopes validate against event-envelope/v1 and audit-event/v1. **Fault injection** (test-only trigger failing the outbox insert): the SUBMIT command and a working-data write roll back completely (state, transition, `submitted_at`, revision unchanged) and the idempotency key stays unconsumed. Denied (403), illegal (409), stale (409) and AI-decision commands write no domain event (only `DENIED` audit rows). Case pins equal the published binding (API and DB row). 6 concurrent commands on one version: exactly one 200, five 409. |
| **INT-005** application → Temporal → officer task → OPA action | **EXPECTED GAP (recorded)** + defect INT-F3 | No CMP-016 workflow instance/request/outbox rows (`sf_workflow.*` empty), no Temporal endpoint configured. The OPA-authorized officer action half is present: every transition records `authz_decision_id` and `authz_policy_revision = m10-b1`. But CMP-015 reports `workflow_advance: SIGNALLED` and `temporal_advanced: true` with nothing signalled (INT-F3). |
| **INT-011** tenant isolation chain | **PASS** | Same mobile on both portals → same CMP-004 `citizen_id`; case rows carry tenant A vs B. Citizen list/get/working-data/transitions/command/working-data-put on the other tenant's case → 404 on both hosts; citizen token from A used on B sees only B's rows. Officer queues contain only their tenant; officer token on the other tenant's host → 401; officer of A addressing B's case on host A → 404 and B's case unchanged. Draft on the other tenant's binding refused. Client tenant headers refused. Outbox rows carry only the case tenant. Runtime logins are NOSUPERUSER/NOBYPASSRLS, FORCE RLS on case tables, no cross-component role membership. |
| **INT-013** external dependency simulation | **PASS** + defect INT-F2 | CMP-004 OTP challenge carries a valid simulation-marker/v1 (`environment: LOCAL`); `/v1/simulated/*` responses are labelled and `no-store`. The host **process** exits without listening for `SF_ENVIRONMENT` = DEVELOPMENT, SIT, UAT, PREPROD, PRODUCTION; a CI runtime refuses a LOCAL placement; the bootstrap refuses UAT before touching the database. Sessions minted from SIMULATED OTP/IdP are not marked (INT-F2). |
| Journey state machine | **PASS** | draft → ready → submitted → received → scrutiny → decision_pending → approved; … → rejected → closed; deficiency loop (officer raises, citizen edits working data, responds, scrutiny resumes). Illegal transitions and wrong actors refused; stale `expected_version` / `expected_state` / `expected_revision` refused (`STALE_REVISION`); replays return `Idempotent-Replayed: true` with the original transition; key reuse with a different body → 409; another citizen reusing a key gets no replay. |
| Contract conformance | **PASS for CMP-015; CMP-004 not checkable** (INT-F1) | All CMP-015 responses (create, list citizen/officer, working-data put/get, commands, get, transitions) validate against the component OpenAPI schemas with `$ref`s resolved to contracts/shared and contracts/m05; errors validate against error-response/v1; both placements validate against SF-CON-PORTAL-PLACEMENT. CMP-004 error bodies validate against error-response/v1; CMP-004 success shapes are pinned by key-set only. |
| BFF seam | **PASS** + defects INT-F4, INT-F5 | Citizen apply drives draft → working data → ready → submitted; view mirrors CMP-015 (`platform_state` passed through, working-data keys cannot spoof `id`/`status`); other citizen's case is a uniform 404. Every CaseState maps to a defined portal/workbench status (none invented). Officer `decide()` from SUBMITTED walks only legal keys to APPROVED/REJECTED (HUMAN, reason code); on decided, draft, DEFICIENCY_RAISED and CITIZEN_RESPONSE cases it returns 409 and issues **no** command. Citizen token in the officer cookie → 401. |

## Findings

| ID | Severity | Owner | Finding | Evidence | Suggested fix |
|---|---|---|---|---|---|
| INT-F1 | Medium | CMP-004 | `services/cmp-004-identity-access/contracts/openapi.json` declares only operationIds — no request/response schemas — so CMP-004 response conformance cannot be machine-checked by any consumer (BFFs rely on undocumented `session_token`, `citizen_id`, `actor_type`, `subject_id`). | `contract-conformance.test.ts` › "declares request/response schemas" (`it.fails`) | Add component schemas for all 8 operations and a contract test that validates handler output against them. |
| INT-F2 | Low | CMP-004 | Sessions minted from SIMULATED OTP/IdP carry no simulation marker: verify and officer-session HTTP responses have no `simulation`, and the `CitizenSessionIssued` event is unmarked (`OfficerSessionIssued` and `CitizenOtpChallengeCreated` are marked). Eng v1.4 s10.4: every simulated transaction is marked. | `int-013-simulation.test.ts` (`it.fails` + observed test) | Propagate the adapter's simulation marker into session issuance responses and `CitizenSessionIssued`. |
| INT-F3 | Medium | CMP-015 | `OutboxOnlyWorkflowAdvance.advance()` resolves as a no-op, so `WorkflowAdvanceGate` returns `SIGNALLED` and the FROZEN SF-CON-COMMAND-TRANSITION record says `phase: TEMPORAL_ADVANCE, temporal_advanced: true` although no workflow engine exists. Consumers and audit readers are told Temporal advanced. | `int-005-posture.test.ts` (observed + `it.fails`) | Make the outbox-only port report deferral (typed result or sentinel) so the gate returns `DEFERRED_TO_OUTBOX` and `temporal_advanced: false`. |
| INT-F4 | Low (latent) | web-citizen / web-officer BFF | `portalStatus` / `workbenchStatus` map WITHDRAWN and CANCELLED to `REJECTED` (citizen UI then says "Not approved / Officer decision") and DEFICIENCY_RAISED / CITIZEN_RESPONSE to `SUBMITTED` (citizen not told action is required). Latent: Phase B BFFs do not drive withdrawal or deficiency, but OPA already lets officers RAISE_DEFICIENCY via the API. | `bff-seam.test.ts` (`it.fails`) | Add explicit portal statuses (e.g. WITHDRAWN, ACTION_REQUIRED) or render from `platform_state`. |
| INT-F5 | Low | web-citizen BFF | Apply is not idempotent across client retries: each POST mints fresh idempotency keys, so a double submit creates two SUBMITTED cases; a mid-sequence failure leaves an orphan draft. | `bff-seam.test.ts` › "observed: the BFF apply is not idempotent" | Accept a client idempotency key (per form session) and resume an existing draft instead of creating a new one. |
| INT-F6 | Medium | CMP-015 (`src/http.ts`) | Unexpected errors are converted to HTTP 500 with no log line: during fault injection both hosts' logs stayed empty at `warn`. Incidents on the hot path would be invisible. | `int-004-outbox.test.ts` fault tests; `.platform-lab/api.log` 0 lines after the run | Log `statusCode >= 500` at error level with correlation id (redacted) in the route wrapper or a host hook. |
| INT-F7 | Low | CMP-004 (`src/plugin.ts:71`) | Every CMP-004 audit event carries `trace_id` = 32 zeros (invalid W3C trace id), 42/42 rows in this run; CMP-015 derives real ids. Breaks trace correlation for identity actions. | admin query on `sf_identity.outbox_event[_platform]` | Derive the trace id from the request (or correlation id) as CMP-015 does. |
| INT-F8 | Low | CMP-004 | Failed authentication (wrong OTP, rejected officer assertion) produces no audit event; identity audit contains only `SUCCESS` results. | same admin query; wrong-OTP test leaves the challenge `PENDING` with no audit row | Audit failed verification/assertion attempts (`result: FAILURE`/`DENIED`) without channel or code. |

Observations (no action required for Phase B): the officer BFF `simulationAllowed()` defaults to
LOCAL when `SF_ENVIRONMENT` is unset (the host still refuses simulators outside LOCAL/CI); the BFFs
hard-code catalogue `IND-SOC-002` and the residence form shape (SAMPLE_LAB, tracked by the CMP-009
follow-up in CCR-M10-001); session and cookie lifetime is 8 h (within the contract maximum of 12 h);
the per-BFF-address rate limit noted by the builder was not re-tested.

## Expected gaps (not wired on this slice, per evidence/SF-M10-B-2)

CMP-016 Temporal sequencing (confirmed: `sf_workflow` empty, officer BFF drives intake transitions),
CMP-022/024 credential issuance, CMP-012 DigiLocker publish, CMP-005 profile, CMP-008 eligibility,
CMP-009 schema validation of working data, Studio → CMP-052 publication (published binding is the
SIMULATED port seeded from fixtures). None of these was failed.

## Recommendation (Phase B scope only)

The wired seams behave as claimed: tenant isolation across two placements, outbox/audit atomicity
(including under injected failure), the full state machine, idempotency, and the environment guards
all pass on PostgreSQL with real OPA. No blocking tenant, security or contract-break gate failed.
Recommend **Phase B platform wiring proceed to independent SEC/UX4G/EVD review**, with INT-F1,
INT-F3 and INT-F6 (Medium) fixed or accepted by the owners before the Phase B gate, and INT-F2,
F4, F5, F7, F8 tracked. This is a recommendation, not a certification; no G3/G6 status is claimed.

## Files

- `tests/integration/m10-platform/run.sh` — brings up hosts A and B, runs the suite, tears down
- `tests/integration/m10-platform/vitest.config.ts`
- `tests/integration/m10-platform/support/platform.ts`, `support/tenant-b.mjs`
- `tests/integration/m10-platform/{contract-conformance,int-004-outbox,int-005-posture,int-011-two-tenants,int-013-simulation,journey-state-machine,bff-seam}.test.ts`
- `logs/`, `junit/` — this run
