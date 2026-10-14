# SF-M07-SEC evidence — independent security verifier (re-verify after rem)

**Not CERTIFIED. Not G3. Not G6. self_certified false. Recommend only.**

| Field | Value |
|---|---|
| Task | SF-M07-SEC |
| Components | CMP-022 · CMP-024 · CMP-023 · CMP-012 |
| Integrations | INT-008 · INT-011 · INT-013 |
| Branch | `cursor/m07-sec-91f2` |
| Base (re-verify) | `e8f847af…` (rem #153 + #152 on main) |
| Suite | `pnpm exec vitest run -c tests/security/m07/vitest.config.ts` |
| Result (no DB) | **37 PASS, 7 skipped** (DB file `describe.skipIf`) — `logs/vitest-rereverify.log` |
| CROSS_TENANT_LEAKAGE | **0** |
| Production/owner code modified | **false** |
| Blocking hard-gate failures | **0** |

## Closed after remediations

| ID | Sev | Status |
|---|---|---|
| M07-SEC-F05 | HIGH | **CLOSED** by #153 — verify path logs `:opaque_token` template only |
| M07-SEC-F06 (ISSUED) | HIGH | **CLOSED** by #152 — unknown/non-ISSUED credentials refused via CMP-022 port |
| M07-SEC-F01 (tenant headers) | MEDIUM | **CLOSED** for `x-tenant-*` / `x-sf-*` / `Forwarded tenant=` by #152 |

## Open non-blocking / residuals

| ID | Sev | Notes |
|---|---|---|
| M07-SEC-F06 (consent) | MEDIUM residual | No CMP-030 consent verification port yet (schema still requires consent/purpose refs) |
| M07-SEC-F04 | MEDIUM | CMP-012 `!decision.allow` truthy permit; null → 500 |
| M07-SEC-F02 | MEDIUM | CMP-012 accepts non-UUID tenant / bad actor id at component boundary |
| M07-SEC-F01 residual | LOW | `x-roles` / `x-actor-type` / `x-assurance` / `x-org-id` still accepted at component; host edge blocks |
| M07-SEC-F03 | LOW | `x-bypass-rls` passes host edge; inert |

## Certification stance

CERTIFIED=false · G3=false · G6=false. HIGH log-token and ISSUED-publish gates closed. **Recommend G3 for EVD consideration**; remaining MEDIUM/LOW are non-blocking for module-exit recommend. EVD must not issue G3.
