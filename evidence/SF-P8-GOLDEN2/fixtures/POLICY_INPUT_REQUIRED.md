# Owner policy inputs — IND-SOC-031 Income Certificate (SAMPLE_LAB DUMMY + SF-33)

**M11 second-service reuse · SF-61 path polish.** Eng v1.4 example service.

Owner-authorized **SAMPLE_LAB DUMMY** placeholders let Studio configure and lab-offer a
**DRAFT** form without inventing real statute. Values come from
`templates/certificate-packs/sample-lab-dummy/defaults.json` +
`templates/income-certificate/owner-config.json`. **SF-33** still blocks statutory
**PUBLISHED** / non-DUMMY citizen offer. **Replace before any non-lab use.**

| # | Field / section | Lab status | SF-33 / notes |
|---|---|---|---|
| 1 | `pilot_tenant_id` / cell | SAMPLE_LAB DUMMY | `SAMPLE_LAB_PILOT_CELL` — tenant overlayable |
| 2 | `legal_basis` | SAMPLE_LAB DUMMY | Not an Act citation — **owner must replace** |
| 3 | `eligibility_rules` | SAMPLE_LAB DUMMY | Synthetic summary — **not** statutory thresholds |
| 4 | `evidence_requirements` | SAMPLE_LAB DUMMY | `SAMPLE_LAB_DUMMY_EVIDENCE_ANY` |
| 5 | `fee_schedule` | SAMPLE_LAB DUMMY | ₹9.99 (999 paise) — tenant-overridable; do not assume ₹0 |
| 6 | `sla_processing_days` + anchors | SAMPLE_LAB DUMMY | 15 working days — tenant-overridable |
| 7 | `credential_template_id` | SAMPLE_LAB DUMMY | `SAMPLE_LAB_DUMMY_IND_SOC_031_V1` · SIMULATED |
| 8 | `notification_template` | SAMPLE_LAB DUMMY | `SAMPLE_LAB_DLT_PE_ID` — REAL SMS owner/G6 |
| 9 | Form field set | READY (registry) | Catalogue stub uses Recommended Core Fields only |
| 10 | Studio authoring shell | READY | `templates/income-certificate/` |
| 11 | Dry-run TSB pin graph | READY (dry-run) | `tsb-dry-run-fixture.json` — not G6-sealed |
| 12 | Statutory PUBLISH / placement as PUBLISHED | **BLOCKED** | Requires SF-33 owner policy package |

## Fail-closed behaviour

- `policyInputsPending` is cleared by SAMPLE_LAB DUMMY stamps (lab only).
- Maturity remains `SAMPLE_LAB_STUB`; version remains `DRAFT` (not `PUBLISHED`).
- SAMPLE_LAB placement may lab-offer the DRAFT form; runtime refuses DUMMY outside `environment_label=SAMPLE_LAB`.
- Do not claim CERTIFIED, G6, REAL DigiLocker, or citizen-offerable **PUBLISHED** without SF-33.
