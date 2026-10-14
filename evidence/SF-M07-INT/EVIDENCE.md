# SF-M07-INT evidence — independent integration stitcher (INT-008 / INT-011 / INT-013)

**Not CERTIFIED. Not G3. Not G6. self_certified false. Recommend only.**

| Field | Value |
|---|---|
| Task | SF-M07-INT |
| Authorization | `HUMAN_M07_THROUGH_EVD_AUTHORIZATION = true` |
| Branch | `cursor/m07-int-91f2` |
| Base (re-verify) | `e8f847afb1bfe155028dc99706399fbe2adca708` (rem #153 + #152 on main) |
| Prior base | `dfa96a0e…` (host #149) |
| Run | local vitest 5.0.3 — `logs/vitest-rereverify.log` |
| Model | route `opus`, release `claude-opus-5-5` |
| Suites | INT-008 path · INT-008 no-reversal · INT-011 seams · INT-011 host · INT-013 modes |
| Result (post-rem) | **67 tests: 65 PASS, 2 expected-fail (MEDIUM F03/F04), 0 unexpected failures** |
| Findings exposed | `M07_INT_SHOW_FINDINGS=1` → 2 fail / 65 pass (`logs/findings-exposed.log`) |
| Production code modified | **false** (stitcher wiring + tests + evidence only) |
| CROSS_TENANT_LEAKAGE | **0** |

Command: `npx vitest run --config tests/integration/m07/vitest.config.ts`
Artifacts: `junit/independent-int.xml`, `logs/*.log`.

## Post-remediation flips

After #152 (DigiLocker F01/F05/F06) and #153 (QR log redaction):

- Wired stitcher-owned `CredentialVerificationBridge` (CMP-012 → CMP-022) in `support/wiring.ts`.
- Converted HIGH finding tests F01 / F01b / F01c / F05 / F06 from `it.fails` → ordinary `it` (CLOSED).
- MEDIUM F03 / F04 remain as `finding()` expected-fail (non-blocking for G3 recommend).

## Closed HIGH findings

| ID | Sev | Owner | Status |
|---|---|---|---|
| M07-INT-F01 / F01b / F01c | HIGH | CMP-012 | **CLOSED** by #152 (credential ISSUED port) |
| M07-INT-F05 | HIGH | CMP-012 | **CLOSED** by #152 (forged-header defence) |
| M07-INT-F06 | HIGH | CMP-012 | **CLOSED** by #152 (adapter/binding mode cross-check) |

## Open non-blocking

| ID | Sev | Owner | Notes |
|---|---|---|---|
| M07-INT-F03 | MEDIUM | CMP-012 | Publish response not fully projectable to FROZEN SF-CON-DIGILOCKER-PUBLISH |
| M07-INT-F04 | MEDIUM | CMP-012 | Audit envelope still `AuditEvent` / null tenant (siblings use `AuditEventSubmitted`) |
| M07-INT-F02 | MEDIUM | seam ADR | OFFICER vs SYSTEM registration actor policy undefined |
| M07-INT-O1…O3 | LOW | various | characterised observations |

## Gate recommendation (human/CI decides)

Blocking HIGH findings closed. Host tenant isolation PASS (leakage 0). PRODUCTION SIMULATED fail-closed PASS for CMP-022 and CMP-012 adapter/binding.

recommended_result: `SF_M07_INT_PASS_HIGH_CLOSED_NON_BLOCKING_MEDIUM_REMAIN`

CERTIFIED=false · G3=false · G6=false. EVD may recommend `G3_INTEGRATION_VERIFIED`; EVD must not issue G3.
