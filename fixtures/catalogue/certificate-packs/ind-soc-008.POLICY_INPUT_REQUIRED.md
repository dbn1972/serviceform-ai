# Owner policy inputs — IND-SOC-008 Rural Area Certificate (FAIL-CLOSED)

**SAMPLE_LAB configurable authoring pack.** Do not invent statute.

Until the statutory owner supplies the fields below, this stub **must stay gated**:
DRAFT form version only, not in citizen placement offerings, `isOffered` false, apply 404.

| # | Field / section | Status | Notes |
|---|---|---|---|
| 1 | `pilot_state_or_jurisdiction` | **POLICY_INPUT_REQUIRED** | State/UT or cell — owner only |
| 2 | `legal_basis` | **POLICY_INPUT_REQUIRED** | Do not invent Act/section |
| 3 | `eligibility` / rules | **POLICY_INPUT_REQUIRED** | Thresholds, categories, scope — owner only |
| 4 | `evidence` | **POLICY_INPUT_REQUIRED** | Accepted proofs — owner only |
| 5 | `fee` | **POLICY_INPUT_REQUIRED** | Do not assume ₹0 from Residence |
| 6 | `service_time` / SLA + anchors | **POLICY_INPUT_REQUIRED** | Do not copy another service |
| 7 | `credential_template_id` | **POLICY_INPUT_REQUIRED** | SAMPLE_LAB DigiLocker doc type only after owner lab label |
| 8 | `notification_template` | **POLICY_INPUT_REQUIRED** | DLT PE-ID not inventable |
| 9 | Form field set | READY (registry) | Catalogue stub uses Recommended Core Fields only |
| 10 | Studio authoring shell | READY (gated) | `templates/certificate-packs/ind-soc-008/` — all policy YAML = POLICY_INPUT_REQUIRED |

## Registry grounding (non-policy)

| Field | Value |
|---|---|
| Catalogue id | `IND-SOC-008` |
| Category | Residence, Community & Socioeconomic Status |
| Output type | Certificate |
| Issuing authority class | Revenue Department / District Administration / Competent Caste Authority |
| Lifecycle class | Rule-dependent |
| DigiLocker suitability (registry) | High |

## Fail-closed behaviour

Any runtime path that would treat this service as offered, evaluate invented eligibility,
or claim REAL DigiLocker for IND-SOC-008 MUST refuse until the owner table above is
resolved into an approved SAMPLE_LAB (or production) package and placement binds a
PUBLISHED version.

Owner config JSON Schema: `templates/certificate-packs/owner-config.schema.json`.
