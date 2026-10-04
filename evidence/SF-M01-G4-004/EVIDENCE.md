# SF-M01-G4-004 evidence — M01 G4 residual dispositions

**Token:** `SF-M01-G4-004_READY`  
**Not CERTIFIED.**

| Field | Value |
|---|---|
| Task | SF-M01-G4-004 |
| Residual table | `docs/verification/M01-G4-RESIDUALS.md` |
| Docs baseline | `ab8359f0ffe96834bdf61318d1db7877433e7dcc` |
| Envelope baseline | `c42c7c89aa75653d099883e7f28ece73cf2c7515` |
| Frozen contracts | 13/13 MATCH (unchanged) |
| Self-certified | false |
| CERTIFIED | false |

## Deliverables

| Path | Role |
|---|---|
| `docs/verification/M01-G4-RESIDUALS.md` | Authoritative residual register + dispositions |
| `evidence/SF-M01-G4-004/ARTIFACT-INDEX.json` | Machine-readable bind |
| `evidence/SF-M01-G4-004/residuals-summary.json` | Compact status map |
| `evidence/SF-M01-G4-004/contracts-lock.log` | Executed lock gate output |
| `orchestrator/handovers/SF-M01-G4-004.yaml` | Envelope lifecycle update |

## Key dispositions

| ID | Status |
|---|---|
| R-ENV-INT | OPEN_DEPENDS → SF-M01-G4-001 |
| R-OUTBOX-SF-APP (ADR-0006 #9) | ACCEPTED_RESIDUAL (no CCR; no silent contract edit) |
| R-PROVENANCE | CLOSED (formalized headSha rule) |
| R-BRANCH-PROT | OPS_CONFIRM before CG-01 |
| R-COV / R-INFRA / R-DPDP / R-CMP055-PKG / R-RUNTIME / R-BUILDER-JUNIT / R-HYGIENE-RATELIMIT | CARRIED |
| R-MIG-TS / R-LOCKFILE-W2 / R-W2-VERIFY-DISPATCH | CLOSED |
| R-NOT-CERTIFIED | ACCEPTED_RESIDUAL (standing) |

## Constraints observed

- Wrote only envelope allow-list paths
- Did not edit `contracts/**` or `orchestrator/contracts-lock.yaml`
- Did not claim R-ENV-INT closed
- Did not issue M01 G4 exit token
- Did not start M02/M03
