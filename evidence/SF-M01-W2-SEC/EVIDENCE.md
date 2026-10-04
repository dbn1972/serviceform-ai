# SF-M01-W2-SEC evidence index

**Verdict:** `V2_SECURITY_PASS` — `CROSS_TENANT_LEAKAGE=0` — **Not CERTIFIED**

| Field | Value |
|---|---|
| Tip | `347fe74cb0221cbc0b8542bb187aa6adc752405c` |
| Branch | `cursor/m01-w2-stitch-e19b` |
| PR | https://github.com/dbn1972/serviceform-ai/pull/30 |
| Role | Independent security verifier (not builder) |
| Assessed | 2026-10-04T01:56Z |

Primary report: store `docs/m01-wave2-v2-security.md`  
Run artifacts: store `internal/verification/w2-v2-security-runs/`

## Executed locally on tip

| Run | Result |
|---|---|
| Independent LOGIN catalog | 218 PASS / 0 FAIL; CROSS_TENANT_LEAKAGE=0 |
| CMP-003 INT | 6/6 PASS |
| CMP-030 INT | 6/6 PASS |
| CMP-032 INT | 6/6 PASS |
| Composition Phase B (forged header + authz deny) | 7/7 PASS |
| Edge forged headers | 6/6 + app 14/14 PASS |
| Storage INT-013 unit | modes/markers/simulated-store PASS |
| OPA (cmp-048 script + jurisdiction) | PASS |
| packages/security + audit-client | 39 PASS |
| CMP-055 unit | 9/9 PASS |
| db:test | 17/17 PASS |
| migration_lint | PASS |
| contracts-lock | 13/13 FROZEN MATCH |
| gitleaks 8.30.1 | no leaks |
| semgrep 1.179.0 | 0 findings |

## GitHub on tip

| Workflow | Run | Conclusion |
|---|---|---|
| security | 37169194081 | SUCCESS (gitleaks, semgrep, CodeQL, audit, checkov) |
| ci | 37169194082 | SUCCESS |

Frozen contracts unaltered. Thresholds not weakened. Not merged. Not CERTIFIED.
