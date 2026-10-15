# M09 G4 recommendation (independent evidence bind) — HOLD

**Recommended gate: _none_ — do NOT issue `G4_SECURITY_VERIFIED`**

Independent evidence verifier (SF-M09-EVD) bind of executed INT + SEC records after host merges. **Human/CI decides any gate.** This record does **not** certify, issue G3, issue G4, issue G6, or mark CERTIFIED / RELEASE CERTIFIED. M10 remains **POLICY_INPUT_REQUIRED**.

| Field | Value |
|---|---|
| Module | M09 (Interop + privacy/risk/migration/assisted/scheduler/semantic; CMP-056..061; INT-011/013/014/015/016-019) |
| Task | SF-M09-EVD |
| Role | independent evidence verifier |
| Authorization | `HUMAN_CG03_THROUGH_EVD_AUTHORIZATION` |
| Production SoT | `origin/main` `01b3a3aeaac87c1556b35603f1d4fb17ea5664b3` (post INT #173 merge) |
| Disposition | **`SF_M09_EVD_HOLD_G4_NOT_RECOMMENDED`** |
| Recommended result | **do not issue `G4_SECURITY_VERIFIED`** (`g4_recommended=false`) |
| Human/CI decision | **required** (this agent does **not** issue any gate) |
| `G4_ISSUED` / `gate_issued` / `human_gate_issued` | **false** |
| Self-certified | **false** |
| CERTIFIED / G3 / G4 / G6 / RELEASE CERTIFIED | **false** |
| M10 | POLICY_INPUT_REQUIRED (no invented residence statute) |

## Bound verifier results

| Gate | Source | Evidence head | Merge commit | recommended_result | G4? |
|---|---|---|---|---|---|
| SEC | [#172](https://github.com/dbn1972/serviceform-ai/pull/172) | `918341201fe3df4ceb2556f84c13c9808897aa63` | `852b2cc3f628efe1c380556a56ed69fffcf4e60b` | **`SF_M09_SEC_FAIL`** | **no** |
| INT | [#173](https://github.com/dbn1972/serviceform-ai/pull/173) | `703c4bab1c9edd3a46b3832a778bbb877b84a314` | `01b3a3aeaac87c1556b35603f1d4fb17ea5664b3` | **`SF_M09_INT_FAIL`** | **no** |

## Why G4 is not recommended

Critical / blocking owner FINDINGS recorded by independent verifiers (production code **not** patched by INT/SEC):

1. **CMP-059** `sf_migration.outbox_event`: PLATFORM_OPERATIONAL + `tenant_id` without FORCE RLS — live Postgres probe: T2 can read T1 outbox event (**CROSS_TENANT_LEAKAGE=1** Postgres).
2. **CMP-060** host without authz adapter falls open to `SimulatedAllowAllTenantAuthz`.
3. Additional INT FINDINGS F-01..F-07 (error envelope, session-context mismatch, SIMULATED in PRODUCTION ungated, review-in-tx, schema, CMP-059 session keys).

HTTP forged-tenant suites: CROSS_TENANT_LEAKAGE=0 (does **not** clear the Postgres critical finding).

Independent agents: [SF-M09-INT stitcher suites](bc-0a208368-24c7-5b12-a472-7aa555f0c533), [SF-M09-SEC security suites](bc-296c4d68-ae66-55fe-a9bb-2acc70124c0a).

## Critical-path merges on SoT

| Step | PR | Merge |
|---|---|---|
| STITCH-A | [#169](https://github.com/dbn1972/serviceform-ai/pull/169) | MERGED |
| SF-M09-HOST | [#170](https://github.com/dbn1972/serviceform-ai/pull/170) | `91640ac…` |
| SF-M10-HOST | [#171](https://github.com/dbn1972/serviceform-ai/pull/171) | `5e915cb…` · POLICY_INPUT_REQUIRED |
| SF-M09-SEC | [#172](https://github.com/dbn1972/serviceform-ai/pull/172) | `852b2cc3f628efe1c380556a56ed69fffcf4e60b` |
| SF-M09-INT | [#173](https://github.com/dbn1972/serviceform-ai/pull/173) | `01b3a3aeaac87c1556b35603f1d4fb17ea5664b3` (SoT tip) |

## Next

Owning remediations for CMP-059 outbox FORCE RLS and CMP-060 DenyAll default; independent INT/SEC re-verify required before any future G4 recommendation.

## Certification stance

CERTIFIED=false · G3=false · G4=false · G6=false · self_certified=false · `g4_recommended=false`.
