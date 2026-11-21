# SAMPLE_LAB DUMMY policy — IND-FRC-020 Essential Commodity Dealer Licence

**Stamp:** `SAMPLE_LAB DUMMY` · synthetic · not statutory · not for production · `CERTIFIED=false` · `G6=false`

Owner-authorized placeholder defaults so this pack can be configured in SAMPLE_LAB without
inventing real government policy. **Replace before any non-lab / production use.**

## Defaults used (shared + per-id)

| Slot | SAMPLE_LAB DUMMY value | Tenant-overridable |
| --- | --- | --- |
| Jurisdiction pilot | `SAMPLE_LAB_PILOT_CELL` | Yes |
| Legal basis | SAMPLE_LAB DUMMY citation (not an Act) | Yes |
| Eligibility | Synthetic eligibility claim | Yes |
| Evidence | `SAMPLE_LAB_DUMMY_EVIDENCE_ANY` | Yes |
| Fee | ₹9.99 (999 paise) | Yes |
| Service time | 15 working days | Yes |
| Credential / DigiLocker | `SAMPLE_LAB_DUMMY_IND_FRC_020_*` · SIMULATED | Yes |
| Notifications DLT | `SAMPLE_LAB_DLT_PE_ID` | Yes |
| Assignment roles | `SAMPLE_LAB_CASE_OFFICER` | Yes |

Shared defaults: `templates/certificate-packs/sample-lab-dummy/defaults.json`  
Per-id overlay: `templates/certificate-packs/ind-frc-020/owner-config.json`  
Tenant / TSB overlay schema: `templates/certificate-packs/sample-lab-dummy/tenant-overlay.schema.json`

## Merge order

1. Shared SAMPLE_LAB DUMMY defaults
2. Per-catalogue-id `owner-config.json`
3. CMP-052 TenantServiceBinding / jurisdiction overlay

## Fail-closed

- Runtime helpers refuse SAMPLE_LAB DUMMY outside `environment_label=SAMPLE_LAB`.
- Citizen apply still requires a PUBLISHED version pinned by placement (Residence only today).
- Do not claim CERTIFIED, G6, or REAL DigiLocker.

## Registry grounding (non-policy)

| Field | Value |
| --- | --- |
| Catalogue id | `IND-FRC-020` |
| Category | Food, Ration & Consumer Services |
| Output type | Licence |
| Issuing authority class | Food & Civil Supplies / Consumer Affairs / Legal Metrology |
| Lifecycle class | Time-bound / renewable / purpose-specific |
| DigiLocker suitability (registry) | High |
