# SF-M01-G4-003 evidence index

**Verdict:** `SF-M01-G4-003_READY` — `CROSS_TENANT_LEAKAGE=0` — **Not CERTIFIED**

| Field | Value |
|---|---|
| Tip | `ab8359f0ffe96834bdf61318d1db7877433e7dcc` (`origin/main`) |
| Role | Independent `serviceform-security-verifier` (not builder) |
| Assessed | 2026-10-04T05:10Z |
| Components | CMP-002, 003, 030, 031, 032, 036, 037, 038, 047, 048, 055 |
| Frozen contracts | **13/13 MATCH** |
| Self-certified | **false** |
| CERTIFIED | **false** |

Primary store report: `docs/m01-g4-v-security.md`

## Executed locally on tip

| Run | Result |
|---|---|
| Independent LOGIN catalog (W1+W2) | **546 PASS / 0 FAIL**; `CROSS_TENANT_LEAKAGE=0` |
| CMP-002 INT | 32/32 PASS |
| CMP-048 INT | 18/18 PASS |
| CMP-031 INT | 36/36 PASS |
| CMP-038 INT (incl. Kafka 4.1.0) | 46/46 PASS |
| CMP-037 INT | 10/10 PASS |
| CMP-003 INT | 6/6 PASS |
| CMP-030 INT | 6/6 PASS |
| CMP-032 INT | 6/6 PASS |
| Edge + host composition (forged header / authz deny) | 28/28 PASS |
| packages/security + audit-client + observability + CMP-047 | 78/78 PASS (combined unit path) |
| packages/storage INT-013 markers | 12/12 PASS |
| CMP-055 unit (path-based) | 9/9 PASS |
| `pnpm db:test` | 17/17 PASS |
| migration_lint | PASS |
| contracts-lock | **13/13 FROZEN MATCH** |
| OPA (`opa-test.sh` + `opa test policy/opa`) | PASS (48/48) |
| gitleaks 8.30.1 (git) | no leaks |
| semgrep 1.179.0 (CI-equivalent config) | **0 findings** |

## GitHub on tip

| Workflow | Run | Conclusion |
|---|---|---|
| security | [37178714612](https://github.com/dbn1972/serviceform-ai/actions/runs/37178714612) | SUCCESS (gitleaks, semgrep, CodeQL, audit, checkov) |
| ci | [37178714591](https://github.com/dbn1972/serviceform-ai/actions/runs/37178714591) | SUCCESS |

## Residuals (non-blocking; not CROSS_TENANT_LEAKAGE)

1. **ADR-0006 #9 / SF-CON-OUTBOX** — frozen `GRANT … TO sf_app` residual recorded; peer outbox insert not observed on this tip (`42P08`). Accept or CCR via G4-004 — never silent contract edit.
2. **R-ENV-INT** — tip `ab8359f` still has W1-named envelope-int job; owned by SF-M01-G4-001 (not this envelope).
3. **Not CERTIFIED** — exit token issuance is G4-005 / human-CI only.

Frozen contracts unaltered. Thresholds not weakened. No M02/M03. Not CERTIFIED.
