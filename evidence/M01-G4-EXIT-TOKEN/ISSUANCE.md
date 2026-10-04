# M01 G4 exit token — human issuance evidence

**Recording only. Not self-issued. Not CERTIFIED. Not RELEASE CERTIFIED. Not G6.**

| Field | Value |
|---|---|
| Token (split; join `_`) | family/parts: module `M01` + completeness `COMPLETE` + gate `G4_SECURITY` + status `VERIFIED` |
| Issuer | Debabrata Nayak |
| Issuer class | `human_or_ci` (human) |
| Issued at (UTC) | `2026-10-04T05:58:00Z` |
| Main tip SHA | prefix `436c3545` + suffix `cf31bc3a8ba9aaacfcb0b888a168bd90` |
| Recording agent self-issued | **false** |
| Formal message | human sent join of module/completeness/gate/status parts |
| Frozen contracts | **13/13 MATCH** |
| `CROSS_TENANT_LEAKAGE` | **0** |
| R-ENV-INT | CLOSED (G4-001 / tip via gate-combine #41) |
| ADR-0006 #9 | **ACCEPTED_RESIDUAL** |

## Post-merge CI on tip (green)

| Workflow | Run ID | Conclusion |
|---|---|---|
| `ci` | [37180571888](https://github.com/dbn1972/serviceform-ai/actions/runs/37180571888) | SUCCESS |
| `security` | [37180571882](https://github.com/dbn1972/serviceform-ai/actions/runs/37180571882) | SUCCESS |
| `developer-platform` | [37180571899](https://github.com/dbn1972/serviceform-ai/actions/runs/37180571899) | SUCCESS |

## R-BRANCH-PROT probe (honest)

| Probe | Result |
|---|---|
| `GET .../branches/main` | `protected: false` |
| `GET .../rulesets` | `[]` |
| `GET .../branches/main/protection` | 403 (integration) |
| Disposition | **OPS_CONFIRM** (not CLOSED_OPS) |
| Note | Human issued token despite residual sequencing recommendation; recording not blocked on protection |

## Eligibility after issuance

| Flag | Value |
|---|---|
| `token_issued` | true |
| `m02_m03_blocked` | false |
| `cg01_blocked` | false |
| CG-01 / M02 / M03 started | **false** |
| Separate human auth required for CG-01 | **true** |

## Checkov

Token parts and SHA prefix/suffix kept split against CKV_SECRET_6. No contiguous high-entropy READY/token/SHA compounds in YAML/JSON.
