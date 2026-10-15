# POLICY_INPUT_REQUIRED — IND-SOC-002 Owner Input Inventory

**Finding M-04 (Architecture Verification ARCHITECTURE-VERIFICATION-001).**  
The following fields require statutory owner input before any fixture is finalised.  
Agents MUST NOT invent values. All fields carry fail-closed sentinel `"POLICY_INPUT_REQUIRED"`.

| # | Field / section | Sentinel value | Notes |
|---|---|---|---|
| 1 | `pilot_tenant_id` | `POLICY_INPUT_REQUIRED` | UUID of the pilot tenant (State/UT government body) |
| 2 | `pilot_tenant_name` | `POLICY_INPUT_REQUIRED` | Official name of the authorising body |
| 3 | `pilot_state_code` | `POLICY_INPUT_REQUIRED` | ISO-3166-2 IN subdivision code, e.g. `IN-MH` |
| 4 | `legal_basis` | `POLICY_INPUT_REQUIRED` | Statutory citation (Act + section) authorising the service |
| 5 | `eligibility_rules` | `POLICY_INPUT_REQUIRED` | GoRules ZEN eligibility expression — owner must supply |
| 6 | `evidence_requirements` | `POLICY_INPUT_REQUIRED` | Mandatory document list (DigiLocker types or physical) |
| 7 | `fee_schedule` | `POLICY_INPUT_REQUIRED` | Prescribed fee, waivers, payment gateway reference |
| 8 | `sla_processing_days` | `POLICY_INPUT_REQUIRED` | Statutory processing SLA in working days |
| 9 | `sla_start_anchor` | `POLICY_INPUT_REQUIRED` | SLA clock start event (e.g., application submission, document verification) |
| 10 | `credential_template_id` | `POLICY_INPUT_REQUIRED` | DigiLocker / VC credential template identifier |
| 11 | `issuing_authority` | `POLICY_INPUT_REQUIRED` | Name of the authority that signs the certificate |
| 12 | `notification_template` | `POLICY_INPUT_REQUIRED` | SMS/email templates; language; DLT PE-ID if applicable |

## Fail-closed behaviour

Any fixture or runtime component that reads these fields MUST treat `POLICY_INPUT_REQUIRED`
as a terminal blocking value. Publication of a TSB referencing any `POLICY_INPUT_REQUIRED`
field MUST be rejected by the Studio publish gate.

## How to supply values

1. The statutory owner (department programme manager) fills this table.
2. Values are reviewed by the tenant admin and a designated legal reviewer.
3. Maker-checker approval is obtained (see `maker-checker-record.yaml`).
4. The contract guardian records updated fixtures and stamps the TSB version.
5. Agents regenerate the tsb-publish-fixture and sfpackage-manifest from confirmed inputs.
6. The EVD agent recommends G6 after Golden E2E passes; a human issues G6.
