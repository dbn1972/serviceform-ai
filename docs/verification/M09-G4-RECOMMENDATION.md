# M09 G4 recommendation (independent evidence re-bind) — RECOMMEND

**Recommended gate: `G4_SECURITY_VERIFIED`**

> Supersedes HOLD bind in merge `926a6fa…` / [#174](https://github.com/dbn1972/serviceform-ai/pull/174) after remediations [#175](https://github.com/dbn1972/serviceform-ai/pull/175) + [#176](https://github.com/dbn1972/serviceform-ai/pull/176) and independent INT/SEC re-verify.

Independent evidence verifier bind. **Human/CI decides G4.** This record does **not** certify, issue G3, issue G4, issue G6, or mark CERTIFIED / RELEASE CERTIFIED. M10 remains **POLICY_INPUT_REQUIRED**.

| Field | Value |
|---|---|
| Module | M09 (CMP-056..061) |
| Task | SF-M09-EVD (re-bind after rem) |
| Authorization | `HUMAN_CG03_THROUGH_EVD_AUTHORIZATION` |
| Production SoT | `origin/main` `710c1ba8571f609260d1bfca11f8a57e6ed1380e` |
| Disposition | **`SF_M09_EVD_PASS_G4_RECOMMENDED`** |
| Recommended result | **`G4_SECURITY_VERIFIED`** |
| `G4_ISSUED` / `gate_issued` / `human_gate_issued` | **false** |
| Self-certified | **false** |
| CERTIFIED / G3 / G4 / G6 | **false** (issuance) |
| Critical findings | **0** (cleared by #175+#176) |

## Bound re-verify results

| Gate | Branch / head | recommended_result | Criticals |
|---|---|---|---|
| SEC-REVERIFY | `cursor/m09-sec-reverify-91f2` | `SF_M09_SEC_PASS_WITH_FINDINGS` (36/36) | **0** |
| INT-REVERIFY | `cursor/m09-int-reverify-91f2` | `SF_M09_INT_PASS_WITH_FINDINGS` (50 pass / 8 residual) | **0** |

## Criticals cleared

1. **CMP-059** outbox FORCE RLS (#175) — static TENANT_SCOPED+FORCE PASS; T2 read of T1 blocked by policy on SoT.
2. **CMP-060** authz fail-open (#176) — `DenyAllTenantAuthz` default; SEC+INT F-04 CLEARED (403).

## Documented residuals (do not block this G4 recommendation; block CERTIFIED/G6)

- INT F-01/F-02/F-03/F-05/F-06/F-07/F-08 (error envelope, session keys, SIMULATED PRODUCTION injection, review-in-tx, schema, validation-before-auth)
- SEC: SIMULATED review-routing env guard; review-in-tx; session-key style FINDING
- Live Postgres `db-rls-live` not re-run in offline CI (rem + static FORCE cover outbox critical)

## Certification stance

CERTIFIED=false · G3=false · **G4 recommended but not issued** · G6=false · self_certified=false · `g4_recommended=true` · `g4_issued=false`.
