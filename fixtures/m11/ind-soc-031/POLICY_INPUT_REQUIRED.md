# Owner policy inputs — IND-SOC-031 Income Certificate (SAMPLE_LAB DUMMY filled)

**M11 second-service reuse.** Eng v1.4 example service.

Owner authorized SAMPLE_LAB DUMMY placeholders so Studio can configure without inventing
real statute. Values are synthetic defaults from
`templates/certificate-packs/sample-lab-dummy/defaults.json` +
`templates/income-certificate/owner-config.json`. **Replace before any non-lab use.**

| # | Field / section | Status | Notes |
|---|---|---|---|
| 1 | `pilot_tenant_id` / cell | SAMPLE_LAB DUMMY | `SAMPLE_LAB_PILOT_CELL` — tenant overlayable |
| 2 | `legal_basis` | SAMPLE_LAB DUMMY | Not an Act citation — owner must replace |
| 3 | `eligibility_rules` | SAMPLE_LAB DUMMY | Synthetic summary — not statutory thresholds |
| 4 | `evidence_requirements` | SAMPLE_LAB DUMMY | `SAMPLE_LAB_DUMMY_EVIDENCE_ANY` |
| 5 | `fee_schedule` | SAMPLE_LAB DUMMY | ₹9.99 (999 paise) — tenant-overridable |
| 6 | `sla_processing_days` + anchors | SAMPLE_LAB DUMMY | 15 working days — tenant-overridable |
| 7 | `credential_template_id` | SAMPLE_LAB DUMMY | `SAMPLE_LAB_DUMMY_IND_SOC_031_V1` · SIMULATED |
| 8 | `notification_template` | SAMPLE_LAB DUMMY | `SAMPLE_LAB_DLT_PE_ID` |
| 9 | Form field set | READY (registry) | Catalogue stub uses Recommended Core Fields only |
| 10 | Studio authoring shell | READY | `templates/income-certificate/` |

## Fail-closed behaviour

- `policyInputsPending` is cleared by SAMPLE_LAB DUMMY stamps.
- Citizen apply still requires a PUBLISHED version pinned by placement (Income remains DRAFT / not placed).
- Runtime refuses SAMPLE_LAB DUMMY outside `environment_label=SAMPLE_LAB`.
- Do not claim CERTIFIED, G6, or REAL DigiLocker.
