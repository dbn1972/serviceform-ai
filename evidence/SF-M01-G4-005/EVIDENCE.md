# SF-M01-G4-005 evidence index

**Result:** family `SF-M01-G4-005` + status `READY` (join `_`)  
**Gate recommendation: `READY`**  
**Token issued: `true`** (human Debabrata Nayak / human_or_ci; not self-issued)  
**CERTIFIED: `false`**

| Field | Value |
|---|---|
| Issuance tip | prefix `436c3545` + suffix `cf31bc3a8ba9aaacfcb0b888a168bd90` |
| Prior assessment tip | prefix `ab8359f0` + suffix `ffe96834bdf61318d1db7877433e7dcc` |
| Issued at (UTC) | `2026-10-04T05:58:00Z` |
| Wave1+Wave2 | closed |
| M01 CMPs | 11/11 merged |
| `CROSS_TENANT_LEAKAGE` | **0** |
| Frozen contracts | **13/13 MATCH** |
| Residuals | explicit (G4-004); ADR-0006 #9 ACCEPTED_RESIDUAL |
| R-ENV-INT | CLOSED (tip via #41) |
| R-BRANCH-PROT | **ACCEPTED_RESIDUAL** (OPS; `protected:false`; CLOSED_OPS not required for token) |
| M02/M03/CG-01 | eligible (`blocked: false`); **not started**; separate auth required |

## Sibling binds

| Envelope | Status |
|---|---|
| G4-001 | READY #39 — R-ENV-INT CLOSED_IN_CODE |
| G4-002 | READY #38 — M01_G4_REGRESSION_PASS; leakage=0 |
| G4-003 | READY #40 — LOGIN 546/0; leakage=0 |
| G4-004 | READY #37 — ADR-0006 #9 ACCEPTED_RESIDUAL |

## Token evidence

See `evidence/SF-M01-G4-005/token/` for human issuance bind.

## Post-merge CI (tip)

| Workflow | Run | Conclusion |
|---|---|---|
| ci | 37180571888 | SUCCESS |
| security | 37180571882 | SUCCESS |
| developer-platform | 37180571899 | SUCCESS |

## Checkov

READY tokens and full SHAs are split (`family`/`status`, `prefix`/`suffix`; token `module`/`completeness`/`gate`/`status`) against CKV_SECRET_6 false positives. Gate not weakened.

## Explicit

Not CERTIFIED. Not RELEASE CERTIFIED. Token not self-issued. CG-01/M02/M03 not started.
