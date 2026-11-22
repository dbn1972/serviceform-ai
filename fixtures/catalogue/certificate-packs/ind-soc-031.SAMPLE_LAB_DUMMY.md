# SAMPLE_LAB DUMMY policy — IND-SOC-031 Income Certificate (individual)

**Stamp:** `SAMPLE_LAB DUMMY` · synthetic · not statutory · not for production · `CERTIFIED=false` · `G6=false`

Hand-crafted M11 authoring shell (not a generated certificate-pack). Owner-authorized
placeholder defaults so Studio can configure without inventing real government policy.
**Replace before any non-lab / production use. SF-33 gates statutory PUBLISH.**

## Defaults used (shared + per-id)

| Slot | SAMPLE_LAB DUMMY value | Tenant-overridable |
| --- | --- | --- |
| Jurisdiction pilot | `SAMPLE_LAB_PILOT_CELL` | Yes |
| Legal basis | SAMPLE_LAB DUMMY citation (not an Act) | Yes |
| Eligibility | Synthetic eligibility claim | Yes |
| Evidence | `SAMPLE_LAB_DUMMY_EVIDENCE_ANY` | Yes |
| Fee | ₹9.99 (999 paise) | Yes |
| Service time | 15 working days | Yes |
| Credential / DigiLocker | `SAMPLE_LAB_DUMMY_IND_SOC_031_*` · SIMULATED | Yes |
| Notifications DLT | `SAMPLE_LAB_DLT_PE_ID` | Yes |
| Assignment roles | `SAMPLE_LAB_CASE_OFFICER` | Yes |

Shared defaults: `templates/certificate-packs/sample-lab-dummy/defaults.json`  
Per-id overlay: `templates/income-certificate/owner-config.json`  
Authoring shell: `templates/income-certificate/`  
Tenant / TSB overlay schema: `templates/certificate-packs/sample-lab-dummy/tenant-overlay.schema.json`  
Dry-run fixtures: `fixtures/m11/ind-soc-031/`

## Merge order

1. Shared SAMPLE_LAB DUMMY defaults
2. Per-catalogue-id `owner-config.json` (Income hand-crafted shell)
3. CMP-052 TenantServiceBinding / jurisdiction overlay

## Fail-closed

- Runtime helpers refuse SAMPLE_LAB DUMMY outside `environment_label=SAMPLE_LAB`.
- Version remains **DRAFT** / maturity **SAMPLE_LAB_STUB** until SF-33 owner policy enables PUBLISH.
- SAMPLE_LAB placement may lab-offer the DRAFT form; that is not a statutory PUBLISHED offering.
- Do not claim CERTIFIED, G6, or REAL DigiLocker.

## Registry grounding (non-policy)

| Field | Value |
| --- | --- |
| Catalogue id | `IND-SOC-031` |
| Category | Residence, Community & Socioeconomic Status |
| Output type | Certificate |
| Issuing authority class | Revenue Department / District Administration / Competent Caste Authority |
| Lifecycle class | Time-bound / renewable / purpose-specific |
| DigiLocker suitability (registry) | High |
