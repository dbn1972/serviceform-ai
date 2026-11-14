# M11 delta capability report — second-service reuse (start)

**Stamp:** SAMPLE_LAB · **CERTIFIED=false · G6=false · self_certified=false**  
**Base:** `41227bbebe71b6b7a48aa016e259ea79315dc8ca`  
**Rule:** Every non-metadata change must trace to an accepted capability-gap CCR/ADR (`specs/build-plan.yaml` M11).

## Metadata-only (no capability gap)

| Artefact | Notes |
|---|---|
| `templates/income-certificate/**` | POLICY_INPUT_REQUIRED shells; form schema from registry core fields |
| `fixtures/m11/ind-soc-031/POLICY_INPUT_REQUIRED.md` | Owner blocker inventory |
| `packages/service-templates` Income `authoring_path` | Points at the shell; maturity remains SAMPLE_LAB_STUB |

## Platform capability gaps (reusable — not Income-specific backend)

| Gap | CCR | Change |
|---|---|---|
| Citizen portal hard-coded `catalogue_id: IND-SOC-002` | CCR-M11-001 | Resolve from placement binding / form version pin |
| `isOffered` ignored pending policy | CCR-M11-001 | Refuse when fee/SLA/eligibility/evidence = POLICY_INPUT_REQUIRED |
| Empty applications CTA deep-linked only to Residence | CCR-M11-001 | Link to `/services` |
| Officer home/queue named IND-SOC-002 only | CCR-M11-001 | Catalogue-generic copy + optional catalogue label from form pin |

## Not introduced

- No `services/**` Income Certificate module
- No Camunda / second workflow runtime
- No named-service branching in CMP-009/015/016/008
- No invented Odisha/statutory Income eligibility, fee, or DigiLocker registration

## Remaining for M11 G3

Owner-approved SAMPLE_LAB (or production) policy package for IND-SOC-031 → publish form/rules/workflow pins → placement offering → second-service E2E suite on generic engines.
