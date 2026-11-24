# Platform-reuse gap list — IND-SOC-031 (P8-6 / D4 Golden-2)

**Stamp:** SAMPLE_LAB · **CERTIFIED=false · G6=false · self_certified=false**  
**Rule:** Second service must be Studio metadata / configuration. No named-service backend. If a gap appears, propose the smallest **generic** platform capability (CCR/ADR) — never `services/**` Income branching.

## Config-only artefacts (no capability gap)

| Artefact | Role |
|---|---|
| `templates/income-certificate/**` | Studio authoring shell (SAMPLE_LAB DUMMY) |
| Studio designer starters `ind-soc-031-{dummy,sla,evidence,credential}` | Fee / SLA / Evidence / Credential DUMMY overlays |
| `fixtures/m11/ind-soc-031/**` | SF-33 inventory, TSB dry-run, maker-checker dry-run, overlays |
| Catalogue stub maturity `SAMPLE_LAB_STUB` / versions `DRAFT` | Honest ceiling until SF-33 |
| SAMPLE_LAB placement lab-offer of DRAFT form | Fail-closed outside `environment_label=SAMPLE_LAB` |

## Platform gaps already closed (reusable — not Income-specific)

| Gap | CCR / path | Status |
|---|---|---|
| Portal hard-coded `catalogue_id: IND-SOC-002` | CCR-M11-001 | Closed — resolve from placement / form pin |
| `isOffered` ignored while policy pending | CCR-M11-001 | Closed — refuse `POLICY_INPUT_REQUIRED` |
| Empty applications CTA → Residence only | CCR-M11-001 | Closed — `/services` |
| Officer queue copy named Residence only | CCR-M11-001 | Closed — catalogue-generic |
| SAMPLE_LAB lab-offer of DRAFT + DUMMY | lab path | Closed — fail-closed outside SAMPLE_LAB |

Prior report: `docs/verification/M11-DELTA-CAPABILITY-REPORT.md`.

## Remaining gaps for statutory PUBLISH (not product-code)

| Item | Owner | Notes |
|---|---|---|
| **SF-33** IND-SOC-031 policy package | Owner | **Only publish blocker** — see `SF33_PUBLISH_BLOCKER.md` |
| Checker approval for statutory PUBLISH | Owner / ops | Maker≠checker; dry-run stops short |
| TSB immutability seal (G6) | Owner after REAL path | Remains false; not claimed here |
| DigiLocker REAL | Out of scope (path-to-8) | SIMULATED only |

## Explicitly not introduced (P8-6)

- No new `services/**` Income Certificate backend  
- No frozen CMP/INT contract edits  
- No DigiLocker REAL / connector mode flip  
- No invented Act citation, eligibility thresholds, or fee schedule  
- No Income version marked `PUBLISHED` / maturity `SAMPLE_LAB_PUBLISHED`

## P8-6 conclusion for D4

**Config-only second-service reuse holds through the honest DRAFT/DUMMY / lab-offer ceiling.** Nothing in this slice requires a new named-service backend. The sole blocker to statutory **PUBLISH** is owner **SF-33**.
