# SF-M10-B-SEC — Phase B independent security verification

| Field | Value |
|---|---|
| Under test | `f334df88053d5b39a27bd4546e04817b66280497` (branch `cursor/m10-phase-b-platform-wire-0b20`, PR #211, stacked on PR #210) |
| Verifier | serviceform-security-verifier (B-8). Resolved model: claude-opus-5-5 (role default `opus`). Did not build this code. Same model family as the builder; human/CI review of this report is still required |
| Run | 4 Nov 2026, Cursor cloud VM. Node 22.23.4, PostgreSQL 16.15 (own cluster `secverify`, port 5434), OPA 1.21.1, Chromium headless shell 1243 |
| Ports | API host 4100, OPA 8281, citizen BFF 3100, officer BFF 3101 (Next.js production builds) |
| Stamp | SAMPLE_LAB · SIMULATED OTP/IdP · CERTIFIED=false · G4/G6 not claimed · self_certified=false |
| **Current recommendation** | **PASS-WITH-FINDINGS** after the [re-run of F-06 at 60f0790](#re-run-f-06-at-60f0790). F-01 (hard gate) and F-02, F-03, F-04, F-05, F-06, F-07 and F-12 are fixed and verified. F-08 (Medium), five Lows and the new availability note N-3 (Low) remain |
| Original run (f334df8) | BLOCK. One hard-gate failure: a session token issued for tenant B read tenant A cases (F-01) |

## Original run at f334df8

### Commands

```bash
git worktree add /agent/repos/sf-wt-sec cursor/m10-phase-b-sec-verify-0b20   # from origin/...platform-wire-0b20
pnpm install --frozen-lockfile
sudo pg_createcluster 16 secverify -p 5434 --start   # role ci, DBs sf_sec and sf_sec_int
DATABASE_URL=postgres://ci@localhost:5434/sf_sec SF_OPA_PORT=8281 SF_PLATFORM_LAB_PORT=4100 \
  SF_ENVIRONMENT=LOCAL bash scripts/dev/platform-lab.sh up                  # logs/platform-lab-up.log
pnpm --filter @serviceform/web-citizen run build && pnpm --filter @serviceform/web-officer run build
SF_API_BASE_URL=http://127.0.0.1:4100 SF_ENVIRONMENT=LOCAL SF_PORTAL_PLACEMENT_FILE=$PWD/fixtures/lab/platform/placement.citizen.json \
  pnpm --filter @serviceform/web-{citizen,officer} exec next start -p {3100,3101}
SF_SEC_ADMIN_DB=postgres://ci@localhost:5434/sf_sec \
  pnpm exec vitest run --config tests/security/m10/vitest.config.ts      # logs/security-suite.log, junit/security.xml
opa test policy/opa                                                      # logs/opa-test.log
DATABASE_URL=postgres://ci@localhost:5434/sf_sec_int pnpm --filter @serviceform/cmp-004-identity-access run test:integration
DATABASE_URL=postgres://ci@localhost:5434/sf_sec_int pnpm --filter @serviceform/cmp-015-application-case run test:integration
pnpm exec prettier --check tests/security/m10 && pnpm exec eslint tests/security/m10 --max-warnings=0
```

The suite reads the gitignored `.platform-lab/env` (CMP-004 pepper, runtime DB logins) and never prints it.
Only synthetic data is used (`SAMPLE …` names, `9xxxxxxxxx` mobiles).

### Results

| Suite | Result | Evidence |
|---|---|---|
| `tests/security/m10` (8 files) | 115 tests: **96 pass, 19 fail**. Every failure is a probe named `FINDING …` that asserts the secure behaviour | `logs/security-suite.log`, `junit/security.xml` |
| `opa test policy/opa` | 68/68 PASS | `logs/opa-test.log` |
| CMP-004 integration (PostgreSQL) | 8/8 | `logs/cmp004-integration.log` |
| CMP-015 integration (PostgreSQL) | 31/31 | `logs/cmp015-integration.log` |
| prettier / eslint on `tests/security/m10` | clean | — |

#### Per-area results

| Area | File | Pass | Fail (findings) |
|---|---|---|---|
| Session cookies, cross-surface tokens, revocation, foreign-tenant IdP assertion | `session.sec.test.ts` | 16 | 0 |
| IDOR (host + BFF), SF-TEN-002 headers, officer commands, HUMAN/AI decision boundary | `idor-authz.sec.test.ts` | 27 | 1 (F-09) |
| OTP lockout durability, replay, enumeration, inbox, X-Forwarded-For | `otp.sec.test.ts` | 6 | 2 (F-06, F-10) |
| RLS with bootstrap runtime logins, privilege separation, PII in outbox/inbox/audit | `rls-pii.sec.test.ts` | 14 | 0 |
| OPA owner path, citizen roles, management API, fail-closed and recovery | `opa.sec.test.ts` | 11 | 1 (F-13) |
| Officer session binding to the presented token | `officer-session-binding.sec.test.ts` | 0 | 5 (F-01, F-02, F-03, F-05) |
| Open redirect (unit + headless Chromium) | `open-redirect.sec.test.ts` | 6 | 6 (F-04) |
| Simulator/placement guards, UAT start refusal, CSRF, L-2, errors, headers | `guards-csrf-headers.sec.test.ts` | 16 | 4 (F-07, F-11, F-12) |

#### Controls that held (executed)

- **L-1 closed.** Legacy `sf_lab_session`, base64/base64url JSON, JWT `alg=none`, token-shaped random values and duplicate cookies are all anonymous (401 on lists). Cookies are `HttpOnly; SameSite=Lax; Path=/` and hold only an opaque token with no decodable claims.
- Citizen token in the officer cookie, and officer token in the citizen cookie: no session, 401 on queues and lists.
- Citizen and officer sign-out: the token is refused afterwards on the BFF and on the host (single-tenant case; see F-02 for the multi-session case).
- An officer IdP assertion for a non-placement tenant gets no session. Forged signatures, tampered tenant and expired assertions are refused.
- IDOR: citizen B gets 403/404 with no PII for citizen A's case, transitions and working data. B cannot write A's working data or run commands on A's case, and A's version is unchanged afterwards. B's list never contains A's ids. List rejects `applicant_id`, `owner_id` and `tenant_id` query keys. On the BFF, another citizen's case is 404, non-UUID and traversal ids are 404, and PII responses are `no-store`.
- SF-TEN-002: `x-tenant-id`, `x-sf-tenant`, `tenant-id`, `x-roles`, `x-actor-type`, `x-actor-id` and `Forwarded: tenant=` are refused with 403. The BFF does not forward client headers.
- The owning citizen cannot execute MARK_RECEIVED, ENTER_SCRUTINY, ENTER_DECISION_PENDING, RAISE_DEFICIENCY, RECORD_APPROVED, RECORD_REJECTED or CLOSE. Officer RECORD_APPROVED is refused with no attestation, `AI`, `SYSTEM`, `LLM` or a malformed attestation, and accepted only with `HUMAN`. Officers cannot write working data or create drafts.
- OPA (real, `m10-b1`): non-owner, missing or non-string `owner_id`, low assurance, tenant mismatch, unknown tenant and `actor_type` spoofing are all denied. A citizen with roles gets `CITIZEN_ROLES_FORBIDDEN`. The PEP token cannot write data or policies.
- **Fail closed:** with OPA stopped, list, get, transitions, create and command all return ≥403 and no data. After OPA restarts, the host recovers in about 5 s without its own restart.
- RLS: runtime logins `sf_lab_cmp004` and `sf_lab_cmp015` are NOSUPERUSER and NOBYPASSRLS. Placement-tenant rows in `application_case`, `application_working_data`, `case_transition` and `idempotency_record` are invisible under another tenant and with no tenant. Cross-tenant UPDATE affects 0 rows. `tenant_id` is not updatable. `case_transition` cannot be deleted and the outbox is insert-only. Each component login is denied the other component's schema, and `DISABLE ROW LEVEL SECURITY` is refused.
- PII: no applicant name, address, DOB, `applicant_name` key or mobile number appears in any `outbox_event*`, `inbox_event*` or `audit_event*` table. CMP-004 stores channels and tokens only as hashes.
- OTP: lockout after 5 wrong codes is persisted (`LOCKED`, attempts 5), and the correct code is then refused on both host and BFF with one generic message. A verified challenge cannot be replayed. Challenge responses look the same for new and existing numbers. The inbox only answers for UUID ids and sends `no-store`.
- `X-Forwarded-For`/`X-Real-IP` are not trusted, so rotating them does not rotate the rate-limit bucket.
- Simulators: `assertSimulatorEnvironment` refuses UAT, PREPROD, PRODUCTION, SIT, DEVELOPMENT, an empty value and lowercase `local`. `registerLabSimulators` and `buildPlatformLab` refuse UAT. The host process exits non-zero with `refused in UAT` and does not listen. The officer BFF disables SIMULATED IdP outside LOCAL/CI. Placement is refused for PRODUCTION/PREPROD, on environment mismatch, and for client-tenant or request-derived variants.
- Errors from the host and BFF contain no stack traces, SQL or schema names. Portal pages send `frame-ancestors 'none'`, `X-Frame-Options: DENY` and `nosniff`, and no `x-powered-by`.

### Findings (original run)

| ID | Severity | Finding | Evidence | Recommended owner fix |
|---|---|---|---|---|
| F-01 | **High — hard gate (cross-tenant)** | CMP-004 `IdentityContextResolver` builds the context from `lookupActiveBySubject`, which picks the subject's latest-expiring ACTIVE session, not the session behind the presented token. Phase B newly routes officer roles through this and composes it into the portal host (`apps/api/src/platform/context.ts`). With a second officer session seeded in another tenant (the shape a multi-tenant officer's IdP sign-in produces), a **token issued for the tenant-B session listed 9 tenant-A cases** on the tenant-A host, and `/v1/identity/me` for a tenant-A token reported the tenant-B tenant. In the Phase B lab this is latent: OPA refuses officer sessions for non-onboarded tenants (verified), so seeding was needed. It becomes reachable as soon as a second tenant onboards the same officer subject | `officer-session-binding.sec.test.ts`: "credential issued for a tenant-B session reads tenant-A cases" (200, 9 rows) and "token for a tenant-A session resolves to the later tenant-B session context" | CMP-004 owner: carry `session_id`/`tenant_id`/`role_codes` from `lookupByToken` through the verified principal and resolve the context from **that** session only. Remove subject-based resolution from request paths. Add an integration test with two sessions in two tenants |
| F-02 | High | Same root cause: officer sign-out with the presented token **does not revoke that session** while a later session exists. Revoke resolves the other tenant, OPA denies it (403), and the presented token stays `ACTIVE`. After the other session ends, the token works again (200). The officer BFF clears the cookie regardless, so the officer believes they are signed out | session-binding: "signing out with the tenant-A token…" (403; status `ACTIVE`; reuse 200) | CMP-004: revoke by the presented `token_hash`/`session_id` (optionally "sign out everywhere" as a separate action). The BFF should surface a failed revoke |
| F-03 | Medium | Same root cause: roles come from the latest same-tenant session. A later role-less session turned the presented session's queue into 403. The reverse (an older token gaining a newer session's roles) follows from the same code | session-binding: "roles come from the latest same-tenant session" | Fixed by F-01 |
| F-04 | Medium | Open redirect on citizen and officer sign-in `next`. Both `safeNext` functions validate the origin after WHATWG normalisation and then return the *normalised* path, so `/.//evil.example`, `/..//evil.example`, `/%2e//evil.example` and `/a/..//evil.example` become `//evil.example`. In headless Chromium the officer landed on `evil.example` after sign-in, and the citizen "Continue" link had `href="//evil.example"` and navigated off-site | `open-redirect.sec.test.ts` (4 unit + 2 runtime failures) | Citizen and officer web owners: reject when the normalised path starts with `//` or `/\`, or allow-list route prefixes. Add these payloads to unit tests |
| F-05 | Medium (pre-existing in CMP-004; on the Phase B officer path) | A `DISABLED` officer principal is set back to `ACTIVE` by the next IdP sign-in (`ON CONFLICT … SET status = 'ACTIVE'`). Existing sessions of a disabled officer stay usable because `lookupByToken` never checks principal status | session-binding: "DISABLED officer principal is re-activated" (live 200, new session 200, status `ACTIVE`) | CMP-004: refuse issuance for DISABLED principals, and check principal status (or revoke sessions) on disable |
| F-06 | Medium | OTP lockout is per challenge only. 12 challenges for one number were all `PENDING` at once, and nothing caps challenges per channel, so 5 guesses per challenge × unbounded challenges defeats the lockout. The only bound is the shared BFF-IP rate limit (F-08) | `otp.sec.test.ts`: 12 concurrent PENDING | CMP-004: supersede earlier challenges per channel, add a per-channel failure budget/backoff, and rate-limit per client and per channel |
| F-07 | Medium | No CSRF defence beyond `SameSite=Lax`. The officer decision POST (`REJECT`, 200) and citizen apply POST (201) were accepted with `Origin: https://evil.example`, `Sec-Fetch-Site: cross-site` and `Content-Type: text/plain`, a simple request with no preflight. Lax does not protect against same-site sibling origins (other subdomains of the same registrable domain) | `guards-csrf-headers.sec.test.ts` (two CSRF failures) | Both BFFs: require `application/json` and verify `Origin`/`Sec-Fetch-Site` against the own origin on every state-changing route, or add a CSRF token |
| F-08 | Medium (builder-stated, assessed) | The CMP-004 rate limit is keyed by the BFF address, so all citizens share one bucket (the lab raises it to 3000). One client can exhaust it (DoS), and there is no per-client brute-force limit (compounds F-06). Verified that forwarded headers are *not* trusted, so the bucket cannot be rotated | otp: X-Forwarded-For probe; `runtime.ts` | Platform owner: forward the client address through a trusted hop (Fastify `trustProxy` limited to the BFF), and key OTP limits by client and channel |
| F-09 | Low (builder-stated, assessed) | CMP-015 get-by-id returns 403 for another citizen's case and 404 for an absent id, which is an existence oracle for any host caller with a citizen token. The citizen BFF maps both to 404 (verified), so it is not exposed through the portal | idor: "FINDING: host get-by-id distinguishes…" | CMP-015: return 404 for non-owner citizen reads |
| F-10 | Low | An OTP challenge for a `LOCKED` citizen principal returns 403 `SF-AUTH-002` (relayed by the BFF) instead of the normal 200/201, so account state can be enumerated by mobile number | otp: "locked principal answered 403 SF-AUTH-002" | CMP-004: return the normal challenge response and fail silently at verify |
| F-11 | Low | L-2 is closed at the BFF only. CMP-015 accepts a non-synthetic `applicant_name` through a direct host PUT (200). Other fields (address, `applicant_mobile`, Aadhaar last 4) are not checked as synthetic | guards: L-2 tests | Keep the BFF check, and add CMP-009 schema/SAMPLE_LAB rules at CMP-015 (already named in CCR-M10-001) |
| F-12 | Low | Host CMP-015 working-data (PII) responses carry no `Cache-Control`. The BFF adds `no-store` (verified) | guards: "host CMP-015 working-data … no Cache-Control" | CMP-015/host: `Cache-Control: no-store` on all case and working-data responses |
| F-13 | Low (pre-existing CMP-048, outside Phase B) | OPA token authentication uses literal identity names. `Authorization: Bearer grant-publisher` reads `data.sf_runtime` (200) and, per `system.authz`, may write privileged grants. The lab OPA binds only to 127.0.0.1, and `SF_OPA_TOKEN=pep` is a constant | opa: "OPA bearer tokens are literal identity names" | CMP-048: issue secret tokens per identity (or use mTLS) and map them to identities in `system.authz` |
| F-14 | Info (builder-stated, accepted for lab) | The SIMULATED OTP inbox returns the code to anyone holding the challenge id. Verified: UUID-gated, `no-store`, and refused outside LOCAL/CI at unit and runtime level | otp + guards | None for LOCAL/CI. Keep the environment guard |

### Recommendation at f334df8 (Phase B scope only)

**BLOCK.** Hard gate `cross_tenant_leakage` requires zero leaks. F-01 shows that a session credential scoped to one tenant yields
another tenant's context and data. The Phase B lab cannot reach it without seeding, because OPA refuses non-onboarded tenants,
but it is in the session path that ADR-0007 D-3 relies on. F-02 also breaks D-3's revocation guarantee. The fix is narrow and
in CMP-004 (resolve the context from the presented session), and it closes F-01, F-02 and F-03 together. Then re-run
`officer-session-binding.sec.test.ts` (all five probes must pass) and this suite independently.

The Phase A findings themselves are closed: L-1 is closed on all three layers (session, OPA ownership, RLS). L-2 is closed at
the BFF, with F-11 left as a Low. F-04 and F-07 (Medium) should be fixed before any external UAT. F-05, F-06 and F-08 belong
to the CMP-004/platform hardening backlog.

Not CERTIFIED. No G4/G6 claim. Gate status is for human/CI decision.

## Re-run at 8cc021c

| Field | Value |
|---|---|
| Under test | `8cc021cf0a773bb9fcc99b2746ebfb17213e57cb` (PR #211 tip with builder fixes for F-01..F-07, F-12), merged into this branch as `327e6a2` |
| Environment | Fresh cluster `secverify` (5434), fresh bootstrap, OPA 8281, API 4100, citizen/officer BFFs rebuilt and run on 3100/3101. Same tooling as the original run |
| Commands | As in the original run. The same suite was re-run with probes added to try to break each fix (below) |

### Results at 8cc021c

| Suite | Result | Evidence |
|---|---|---|
| `tests/security/m10` (8 files) | 137 tests: **130 pass, 7 fail**. All 7 failures are on findings that are still open or that the builder did not address | `logs/security-suite.log`, `junit/security.xml` |
| `opa test policy/opa` | 68/68 PASS | `logs/opa-test.log` |
| CMP-004 integration | 12/12 (adds the builder's session-binding and OTP regressions) | `logs/cmp004-integration.log` |
| CMP-015 integration | 31/31 | `logs/cmp015-integration.log` |
| `pnpm format:check`, `pnpm lint` | clean | — |

| File | Pass | Fail |
|---|---|---|
| `session.sec.test.ts` | 16 | 0 |
| `idor-authz.sec.test.ts` | 27 | 1 (F-09) |
| `otp.sec.test.ts` | 8 | 3 (F-10, F-06 ×2) |
| `rls-pii.sec.test.ts` | 14 | 0 |
| `opa.sec.test.ts` | 11 | 1 (F-13) |
| `officer-session-binding.sec.test.ts` | 9 | 1 (N-1) |
| `open-redirect.sec.test.ts` | 23 | 0 |
| `guards-csrf-headers.sec.test.ts` | 22 | 1 (F-11) |

### Probes added to try to break the fixes

- **Session binding (F-01, F-02, F-03):**
  - Three concurrent sessions for one officer: tenant A with roles, a later tenant-A session with no roles, and a later tenant-B session. Each token resolves exactly its own tenant and roles (200, 403 and 401 respectively on the tenant-A host; `/identity/me` reports tenant A for the first token and tenant B for the tenant-B token).
  - Sign-out with the first token revokes both tenant-A sessions and leaves the tenant-B session `ACTIVE`.
  - Officer BFF sign-out revokes the presented session even when a later tenant-B session exists.
  - An expired lookup row, and an `ACTIVE` lookup whose `officer_session` row is `REVOKED`, never resolve.
  - By code review, not executed: the resolver returns `null` when the principal object is not the one the verifier produced.
- **Disabled officer (F-05), across tenants:**
  - Disabling the tenant-B principal does not affect tenant-A sessions.
  - Disabling tenant A stops the live tenant-A session at once and refuses a new sign-in, without re-activating the principal.
  - A tenant-B token never yields a tenant-A context.
- **Open redirect (F-04):** 13 dot-segment and backslash variants all fall back, both for the citizen helper and for the officer helper (now in `lib/safe-next.ts`; the component imports it). These include `/./\evil`, `/.\/evil`, `/%2e%2e//`, `/%2E/%2E%2E//`, an embedded tab or newline, `/a/b/../..//` and `/.///`. Same-origin targets are preserved. In headless Chromium, both portals now stay on their own origin.
- **CSRF (F-07):** officer decision, officer sign-in, citizen apply, OTP challenge and session POSTs were each sent 13 variants:
  - foreign `Origin`, `Origin: null`, malformed `Origin`, host-suffix `Origin` and port-prefix `Origin`;
  - `Sec-Fetch-Site: same-site` or `cross-site` with no `Origin`, and a foreign `Origin` with a forged `same-origin`;
  - `text/plain`, form-urlencoded, multipart and `text/plain; application/json` bodies.

  All were refused with 403 or 415, no cookie was set, and the case state was unchanged. A Blob body with no `Content-Type` (the `no-cors` shape) got 415. Cross-site `DELETE` sign-out got 403 and the session survived. Same-origin JSON still works.
- **OTP supersede (F-06):** a superseded challenge's correct code is refused. I also fired 20 challenge requests for one number concurrently, and ran 4 sequential lockout rounds followed by a fresh challenge.

### Per-finding status

| ID | Severity | Status at 8cc021c | Evidence / note |
|---|---|---|---|
| F-01 | High (hard gate) | **FIXED-VERIFIED** | Tenant-B credential gets 401 and 0 cases on the tenant-A host. A tenant-A token keeps tenant A with a later tenant-B session present. The three-session probe passes |
| F-02 | High | **FIXED-VERIFIED** | Revoke with the presented token gets 200 and the token becomes `REVOKED`/401, including through the officer BFF |
| F-03 | Medium | **FIXED-VERIFIED** | A later role-less session no longer changes the presented session's roles |
| F-04 | Medium | **FIXED-VERIFIED** | 23/23 unit and runtime redirect probes pass |
| F-05 | Medium | **FIXED-VERIFIED** | No re-activation. Live sessions stop. Per-tenant principals stay independent. Re-enabling a principal resumes its unexpired sessions (Info, by design) |
| F-06 | Medium | **OPEN (partially fixed)** | Sequential supersede works, but it is racy: **7 of 20 concurrent challenges stayed `PENDING`** (UPDATE-then-INSERT under READ COMMITTED). There is also no per-channel failure budget: after 4 lockouts (20 wrong codes in under a second), a fresh challenge was issued and verified with 200. Fix: serialise per channel (advisory lock or a unique partial index on `(channel_hash) WHERE status = 'PENDING'`) and add a per-channel failure budget/backoff |
| F-07 | Medium | **FIXED-VERIFIED** | Every variant above was refused. Info: the `Origin` check compares host only, ignoring scheme. Not exploitable while a portal is served on one scheme |
| F-08 | Medium | **NOT-FIXED** (builder: ops / trusted proxy) | Unchanged. Still compounds F-06 |
| F-09 | Low | NOT-FIXED (not addressed) | Host still answers 403 vs 404. The BFF still masks it as 404 |
| F-10 | Low | NOT-FIXED (not addressed) | A `LOCKED` principal still gets 403 `SF-AUTH-002` at challenge time |
| F-11 | Low | NOT-FIXED (not addressed) | CMP-015 still accepts a non-synthetic name directly |
| F-12 | Low | **FIXED-VERIFIED** | Working-data responses are `Cache-Control: no-store` |
| F-13 | Low (pre-existing CMP-048) | NOT-FIXED (out of scope) | `Bearer grant-publisher` still reads `data.sf_runtime` |
| F-14 | Info | Accepted for lab | Still LOCAL/CI only |

### New findings

| ID | Severity | Finding | Evidence | Recommended owner fix |
|---|---|---|---|---|
| N-1 | Low | An officer session whose role codes are empty (e.g. after a role removal at the IdP) cannot sign itself out. `OFFICER_SESSION_REVOKE` is role-granted in OPA, so revoke gets 403 and the session stays `ACTIVE`. The session can still call `/identity/me` but nothing role-gated. The BFF clears the cookie anyway | `officer-session-binding.sec.test.ts` "N-1" (403, `ACTIVE`) | CMP-004: let a principal always revoke its own presented session without a role grant (self-service action), or make the grant role-independent |
| N-2 | Medium (part of F-06) | Race in the F-06 supersede, as above | `otp.sec.test.ts` concurrent probe (7 PENDING) | See F-06 |

### Recommendation at 8cc021c (Phase B scope only)

**PASS-WITH-FINDINGS.** No hard gate fails: the cross-tenant probes, RLS/OPA negative tests, fail-closed probes and IDOR probes all
pass, and no Critical is open. F-01 (the blocking finding) and F-02 are fixed and verified, including the three-session and
cross-tenant-disable variants. Open items:

- **F-06/N-2 and F-08 (Medium).** Before any environment with a real OTP connector or external users: serialise challenge
  creation per channel, add a per-channel failure budget, and forward the client address through a trusted hop.
- **N-1, F-09, F-10, F-11, F-13 (Low)** go to the CMP-004, CMP-015 and CMP-048 backlogs.

Not CERTIFIED. No G4/G6 claim. Gate status is for human/CI decision.


## Re-run F-06 at 60f0790

| Field | Value |
|---|---|
| Under test | `60f0790eedb14400a0798d5bcd9ee38809d965e0` (draft PR #216, branch `cursor/m10-cmp004-otp-throttle-0b20`, tip `4a29c27`), merged into a local scratch branch on top of this branch (`691a00b`). The scratch merge was not pushed; this commit contains only tests and evidence |
| Claimed fix | Challenge issuance takes `pg_advisory_xact_lock(hashtextextended(channel_hash, 0))` before superseding. A new challenge is refused with 429 `SF-RATE-001` once the number has 10 or more failed attempts across its non-`VERIFIED` challenges created in the last 15 minutes |
| Environment | Fresh cluster `secverify` (5434), fresh bootstrap, OPA 8281, API 4100, citizen/officer BFFs rebuilt and run on 3100/3101 |
| Commands | As in the original run (`SF_SEC_ADMIN_DB=postgres://ci@localhost:5434/sf_sec pnpm exec vitest run --config tests/security/m10/vitest.config.ts`; CMP-004 integration against `sf_sec_int`). `opa test` and CMP-015 integration were not re-run: 60f0790 touches only CMP-004 |

### Results at 60f0790

| Suite | Result | Evidence |
|---|---|---|
| `tests/security/m10` (8 files) | 146 tests: **141 pass, 5 fail**. All 5 failures are earlier open findings (F-09, F-10, F-11, F-13, N-1). Every F-06 probe passes | `logs/security-suite.log`, `junit/security.xml` |
| `otp.sec.test.ts` | 20 tests: 19 pass, 1 fail (F-10, unchanged). 13 F-06 probes pass | same |
| CMP-004 integration | 14/14 (adds the builder's two PG regressions for F-06) | `logs/cmp004-integration.log` |
| `prettier --check` / `eslint --max-warnings=0` on `tests/security/m10`, `pnpm format:check`, `pnpm lint` | clean | — |

### Probes added to try to break the F-06 fix

| Probe | Result |
|---|---|
| 20 and 50 concurrent challenge requests for one number | All return 200. At most 1 challenge for the number stays `PENDING` (was 7 of 20 at 8cc021c) |
| Budget across abandoned challenges: 5 challenges with 2 wrong codes each, none ever `LOCKED` | The 6th challenge gets 429 with no `challenge_id` |
| Sequential lockout rounds (5 wrong codes per round) | The 3rd challenge is refused with 429 `SF-RATE-001`. The old "fresh challenge then verify 200" bypass is gone |
| Worst-case guesses per window: 5 wrong, then 4 wrong, then a fresh challenge issued at 9 failures and burned | Exactly **14** guesses are recorded in the DB (`sum(attempts)`), then every further challenge gets 429. The budget is checked only at issuance, so the overshoot is bounded at budget − 1 + 5 |
| 30-request challenge storm at 9 failures, then burn every returned id | At most 1 `PENDING`. Recorded attempts stay at most 14. The next challenge gets 429. Wrong codes against superseded ids return 401 without being counted, which is correct because those ids can no longer verify |
| 25 parallel wrong verifies on one challenge | `attempts` = 5, status `LOCKED`. Verify takes `SELECT … FOR UPDATE`, so there are no lost updates |
| Isolation: number A throttled | A fresh number B signs in normally (200) |
| Enumeration: throttle a registered number, a never-verified number and a `LOCKED`-principal number | All three give an identical 429: same status, `error_code`, `message`, body keys and `Retry-After`. The budget check runs before the principal lookup, so F-10's 403 is not reached once a number is throttled |
| Idempotent replay | Replaying a pre-throttle key returns at most its stored response (same `challenge_id`), creates no new `PENDING` challenge, and that challenge's correct code is refused (401). A key first refused with 429 is not persisted, so replaying it is refused again. Reusing a key with another number is not 200 |
| Window | Shifting the number's challenges 14 minutes into the past keeps the 429. 16 minutes lifts it, and the next challenge verifies with 200 |

### F-06 status

**FIXED-VERIFIED** at 60f0790. The supersede race (N-2) is closed by the per-number advisory lock. The per-number failure budget holds across supersede, abandon, concurrency and idempotent replay, is isolated per number, and is not an enumeration oracle.
The effective ceiling is 14 guesses per number per 15 minutes, not 10, because the budget is checked only when a challenge is issued. That is about 1.3k guesses per number per day, roughly a 0.13 % chance of guessing a 6-digit code. This is acceptable for SAMPLE_LAB and recorded for the CMP-004 backlog.

### New findings

| ID | Severity | Finding | Recommended owner fix |
|---|---|---|---|
| N-3 | Low (availability; product decision) | The budget is keyed only on the number, so anyone who knows a citizen's mobile number can keep that citizen from getting an OTP. About 10 wrong verifies per 15 minutes suffice, well under the per-IP limit. This is the expected trade-off of a per-number throttle, and nothing leaks | CMP-004/product: decide by ADR. Options: an escalating or per-(number, client) budget once F-08 forwards a trusted client address, an operator unlock, and alerting on sustained per-number throttling |
| N-4 | Info | Enforcement happens at issuance only, giving the ceiling of 14 described above | Optionally also check the budget in verify before comparing the code |

### Recommendation at 60f0790 (Phase B scope, F-06 targeted)

**PASS-WITH-FINDINGS.** F-06/N-2 move to FIXED-VERIFIED. No hard gate fails, and no Critical or High is open. Open items: F-08 (Medium, trusted proxy) and the Lows N-1, N-3, F-09, F-10, F-11 and F-13. N-4 is Info.

Not CERTIFIED. No G4/G6 claim. Gate status is for human/CI decision.
