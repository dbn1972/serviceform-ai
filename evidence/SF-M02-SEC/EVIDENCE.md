# SF-M02-SEC independent security evidence

**Not CERTIFIED. Not G3. Not G6. Not RELEASE CERTIFIED.**  
Independent verifier recommendation only: **`V1_SECURITY_PASS`**.

## Identity

| Field | Value |
| --- | --- |
| Task | SF-M02-SEC |
| Role | independent security verifier (identity/profile/tenant) |
| Production SoT | `origin/main` `d2530008bdc04ee941ff8a16535168791a3b804f` (merge #63) |
| Verifier / probe commit | `VERIFIER_SHA_PLACEHOLDER` |
| Components | CMP-004, CMP-005 |
| INT | INT-001 (citizen auth → profile / DigiLocker binding fail-closed), INT-011 (tenant isolation) |
| Unmerged siblings | M03-SEC #61 and M03-INT #59 **not** used as production source of truth; **not merged** |

## Executed results

| Check | Result |
| --- | --- |
| Independent vitest (`tests/security/m02`) | 3 files, **11/11 pass** |
| LOGIN-role catalog | **108 pass / 0 fail** |
| `CROSS_TENANT_LEAKAGE` | **0** |
| Forged / client-controlled tenant headers | HTTP 403 `SF-TEN-002`; canary absent from bodies (CMP-004 public+protected and CMP-005 profile routes) |
| INT-011 RLS wrong-tenant SELECT | 0 rows (officer_principal, citizen_profile, profile_claim) |
| Wrong-tenant INSERT | `42501` |
| Unset tenant SELECT | 0 rows |
| Cross-component SQL (LOGIN SELECT/INSERT peer schema) | `42501` |
| Runtime LOGIN SUPERUSER / BYPASSRLS | **false**; group roles NOLOGIN, no BYPASSRLS, not table owners |
| Peer SET ROLE (`sf_cmp004_rw` ↔ `sf_cmp005_rw`) | denied |
| Unauthenticated `/v1/identity/me` | HTTP 401 `SF-AUTH-001` |
| Unauthorized profile read | HTTP 403 `SF-AUTH-002` |
| Null CMP-005 context | HTTP 401 `SF-AUTH-001` |
| PRODUCTION SIMULATED DigiLocker | fail-closed (`CONNECTOR_MODE_FORBIDDEN` / `PRODUCTION_SIMULATED_REFUSED`) |
| PII/secrets in error bodies / captured logs | **absent** (canary/token not echoed) |
| Frozen contracts | **13/13 MATCH** (`contracts_lock_gate` PASS) |
| Path uniqueness envelope | `state: READY`, `dispatched: false` (gate PASS) |
| Write scope vs envelope | PASS (`tests/security/m02/**`, `evidence/**`, handover comments only) |
| Production / contracts / migrations / grants / RLS | **untouched** |

## Explicit residuals (not leakage)

- SF-CON-OUTBOX publisher `USING true` and `sf_app` INSERT on outbox/inbox templates remain frozen (ADR-0006 #9). Counted as residual, **not** `CROSS_TENANT_LEAKAGE`.
- CMP-004 CITIZEN_PRIVATE / PLATFORM_OPERATIONAL tables (`citizen_principal`, OTP/session/link/recovery, `session_lookup`, `idempotency_record_platform`) are documented `rls: NOT_APPLICABLE` (no tenant_id). Isolation is citizen_id keyed; peer-component SELECT remains `42501`. Not counted as leakage.
- CMP-005 `claim_definition` is GLOBAL catalog; `idempotency_record_platform` FORCE RLS is actor-scoped, not tenant-scoped.

## Explicit non-claims

- Not G3, not G4, not CERTIFIED, not G6, not RELEASE CERTIFIED.
- Did not start SF-M02-INT, SF-M02-EVD, or M04.
- Did not merge. Did not waive findings. Did not patch production to force green.
- No CCR: frozen contracts unchanged.

## Handover uniqueness

`orchestrator/handovers/SF-M02-SEC.yaml` and `orchestrator/tasks/SF-M02-SEC.yaml` left at **READY / dispatched false**. Gate `cg01_path_uniqueness_gate.py` was not weakened.

## Recommendation

**`V1_SECURITY_PASS`** from executed evidence only.  
Do **not** start SF-M02-EVD as CERTIFIED. Human/CI gate remains required. `certified: false`.
