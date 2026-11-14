# Owner policy inputs — IND-SOC-031 Income Certificate (FAIL-CLOSED)

**M11 second-service reuse.** Eng v1.4 example service. **Do not invent statute.**

No approved SAMPLE_LAB synthetic policy package for Income Certificate exists in this repository
(unlike IND-SOC-002, which was resolved from the Odisha e-District public Resident Certificate
portal — `fixtures/golden/ind-soc-002/`). Until the statutory owner supplies the fields below,
IND-SOC-031 **must stay gated**: DRAFT form version only, not in citizen placement offerings,
`isOffered` false, apply 404.

| # | Field / section | Status | Notes |
|---|---|---|---|
| 1 | `pilot_tenant_id` / cell | OPEN | May reuse SAMPLE_LAB tenant UUID only after owner confirms scope |
| 2 | `legal_basis` | **POLICY_INPUT_REQUIRED** | Do not invent Act/section for Odisha or any State |
| 3 | `eligibility_rules` | **POLICY_INPUT_REQUIRED** | Income thresholds, household composition, period — owner only |
| 4 | `evidence_requirements` | **POLICY_INPUT_REQUIRED** | Accepted income proofs — owner only |
| 5 | `fee_schedule` | **POLICY_INPUT_REQUIRED** | Do not assume ₹0 from Residence |
| 6 | `sla_processing_days` + anchors | **POLICY_INPUT_REQUIRED** | Do not copy Residence 10 working days |
| 7 | `credential_template_id` | **POLICY_INPUT_REQUIRED** | SAMPLE_LAB DigiLocker doc type only after owner lab label |
| 8 | `notification_template` | **POLICY_INPUT_REQUIRED** | DLT PE-ID not inventable |
| 9 | Form field set | READY (registry) | `packages/service-templates` stub uses Recommended Core Fields only |
| 10 | Studio authoring shell | READY (gated) | `templates/income-certificate/` — all policy YAML = POLICY_INPUT_REQUIRED |

## What M11 may do without these inputs

- Open the Income form package in Studio forms designer (catalogue stub → designer).
- Author CMP-033 FORM drafts / freeze / maker-checker **without** citizen placement.
- Keep citizen apply and officer queue free of Income cases.
- Fix catalogue-generic portal projection (CCR-M11-001) so a future published binding does not need
  bespoke backend code.

## Fail-closed behaviour

Any runtime path that would treat Income as offered, evaluate invented eligibility, or claim REAL
DigiLocker for IND-SOC-031 MUST refuse until the owner table above is resolved into an approved
SAMPLE_LAB (or production) package and placement binds a PUBLISHED version.
