# M11 delta capability report — second-service reuse

**Stamp:** SAMPLE_LAB · **CERTIFIED=false · G6=false · self_certified=false**  
**Base (start):** `41227bbebe71b6b7a48aa016e259ea79315dc8ca`  
**SF-61 polish:** Income dry-run Studio→TSB→portal path/fixtures (DRAFT / SAMPLE_LAB DUMMY; SF-33 gated for statutory PUBLISH)  
**Rule:** Every non-metadata change must trace to an accepted capability-gap CCR/ADR (`specs/build-plan.yaml` M11).

## Metadata-only (no capability gap)

| Artefact | Notes |
|---|---|
| `templates/income-certificate/**` | SAMPLE_LAB DUMMY authoring shell; form schema from registry core fields |
| `fixtures/m11/ind-soc-031/**` | Owner SF-33 inventory + SF-61 dry-run TSB/maker-checker/overlay/path checklist |
| `fixtures/catalogue/certificate-packs/ind-soc-031.SAMPLE_LAB_DUMMY.md` | Catalogue DUMMY inventory (hand-crafted shell) |
| `packages/service-templates` Income `authoring_path` | Points at the shell; maturity remains SAMPLE_LAB_STUB / DRAFT |
| Studio designer starters `ind-soc-031-*` | Fee/SLA/Evidence/Credential SAMPLE_LAB DUMMY (SF-61) |

## Platform capability gaps (reusable — not Income-specific backend)

| Gap | CCR | Change |
|---|---|---|
| Citizen portal hard-coded `catalogue_id: IND-SOC-002` | CCR-M11-001 | Resolve from placement binding / form version pin |
| `isOffered` ignored pending policy | CCR-M11-001 | Refuse when fee/SLA/eligibility/evidence = POLICY_INPUT_REQUIRED |
| Empty applications CTA deep-linked only to Residence | CCR-M11-001 | Link to `/services` |
| Officer home/queue named IND-SOC-002 only | CCR-M11-001 | Catalogue-generic copy + optional catalogue label from form pin |
| SAMPLE_LAB lab-offer of DRAFT stubs | (lab path) | `labOfferVersion` + placement; fail-closed outside SAMPLE_LAB |

## Not introduced

- No `services/**` Income Certificate module
- No Camunda / second workflow runtime
- No named-service branching in CMP-009/015/016/008 engines
- No invented Odisha/statutory Income eligibility, fee, or DigiLocker registration
- No Income version marked PUBLISHED / maturity SAMPLE_LAB_PUBLISHED (SF-33 still required)

## Remaining for M11 G3

Owner-approved SF-33 SAMPLE_LAB (or production) policy package for IND-SOC-031 → publish form/rules/workflow pins → statutory placement offering → second-service E2E suite on generic engines.
