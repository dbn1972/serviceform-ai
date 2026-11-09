# SF-M10-B-2d — CMP-005 citizen profile + CMP-030 consent on the platform path (SAMPLE_LAB)

| Field | Value |
|---|---|
| Task | Phase B slice B-2d (CCR-M10-004, PROPOSED). Builder evidence only; independent verification still required |
| Branch | `cursor/m10-phase-b-2d-profile-4d00`, started on `cad88c9` (B-2c) and rebased onto `origin/main` @ `c56f768` (B-3 merged) |
| Code under test | `d16edf592784b4bd135791a3f40045de302412ad` (later commits add only the CCR and this evidence) |
| Run | 9 Nov 2026, Cursor cloud VM. Node 22.23.4, PostgreSQL 16.15, OPA 1.21.1, Chrome (Playwright via `PW_CHROMIUM_PATH`), Temporal dev server from `platform-lab.sh` |
| Model | claude-opus-5-5 (route `opus`, per MODEL-ROUTING-QUALITY.md); subagent `bc-a96a882f-a2f0-5020-b2e6-eae60f4ad840` |
| Stamp | SAMPLE_LAB · **SIMULATED** privacy publication, OTP, DigiLocker binding · synthetic data only · **CERTIFIED=false · G6=false · self_certified=false** |

## What is exercised

Register on the citizen portal with a synthetic name, mobile and consent → CMP-004 OTP →
BFF creates the CMP-005 profile, grants CMP-030 consent (`SELF`, `WEB`) for
`SAMPLE_LAB_PROFILE_PREFILL`, and writes the `IDENTITY.DISPLAY_NAME` and `IDENTITY.CONTACT_PHONE`
claims → the header shows the profile name and masked mobile → the apply form pre-fills the name
and mobile from the profile by semantic element id → the filed application shows the mobile on the
certificate page (was `—`). The session cookie stays the opaque CMP-004 token.

## Results

| Suite | Result | Evidence |
|---|---|---|
| Repository unit (`pnpm exec vitest run`) | 329 files, **3163/3163 passed** | `unit.log` |
| OPA `opa test policy/opa fixtures/lab/platform/opa`, `opa check --strict`, `opa fmt --list` | **108/108**, clean, clean | `opa-test.log` |
| Playwright, all specs (built portals, lab host with CMP-005/030 mounted) | **71/71 passed**, incl. register → profile name, prefill and certificate mobile; two register negatives | `e2e.log`, `e2e-junit.xml` |
| Platform INT `tests/integration/m10-platform/run.sh` (two tenants) | 64 passed, 2 expected-fail, **5 failed: the same `bff-seam` set recorded on `main` in SF-M10-B-2c and SF-M10-B-3** | `m10-platform-int.log` |
| Architecture gates `scripts/gates/run_all.py` | **10/10** | `gates.log` |
| Typecheck: `apps/api`, `apps/web-citizen`, `apps/web-officer`, CMP-004, CMP-005, CMP-030 | clean | — |
| eslint (`--max-warnings=0`) and prettier on every changed file | clean | — |
| Host log PII scan after the e2e run (`.platform-lab/api.log`) | 0 names, 0 mobiles, 0 claim fields | `pii-log-scan.txt` |

The five `bff-seam` failures post the pre-catalogue flat apply body (422) and assert old status
mappings. They are not touched by this slice and are left to their owners, as in B-2c and B-3.

## Negative and safety checks covered

- Profile read without consent → 403 `MISSING_CONSENT`; another citizen's profile → 403; a
  consent for another subject → 403; a citizen calling the access check → 403; an `x-tenant-id`
  header → `SF-TEN-002`; anonymous → 401 (curl smoke on the live host and Rego tests).
- `CITIZEN_PRIVATE`: a null subject or resource tenant is now a tenant mismatch (Rego tests).
- Consent gate refuses a foreign tenant before any call; non-2xx from CMP-030 fails closed (host
  unit tests).
- Register refuses a non-synthetic name and missing consent before any OTP (e2e), and the session
  API returns 400 `field_errors` for an invalid registration (e2e).
- In SAMPLE_LAB, claims that fail the synthetic-name or synthetic-mobile rule are not shown or
  pre-filled (BFF unit tests).
- No claim in the cookie; the session response does not echo the full mobile (e2e).

## Not done / for verifiers

- Consents carry no `notice_id`: CMP-030 has no notice discovery route (proposed in CCR-M10-004).
- `CONTACT_PHONE` is self-asserted (UNVERIFIED); the portal no longer labels it "verified".
- B-3 files touched: only the policy revision literal in `issuance_workload_test.rego` and the
  shared host composition (`runtime.ts`, `lab-server.ts`, bootstrap role list).
