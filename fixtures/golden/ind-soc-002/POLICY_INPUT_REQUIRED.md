# Owner policy inputs — RESOLVED from Odisha public Resident Certificate reference

**Finding M-04.** Previously fail-closed sentinels. Human authorized a public state sample (2026-10-17).  
**Source:** https://edistrict.odisha.gov.in/ — see `SOURCE_PROVENANCE.md`.

| # | Field / section | Value | Provenance |
|---|---|---|---|
| 1 | `pilot_tenant_id` | `0d15ba00-0001-4000-8000-0d15ba0000d1` | SAMPLE_LAB UUID for Odisha R&DM pilot cell |
| 2 | `pilot_tenant_name` | Revenue and Disaster Management Department, Government of Odisha | Portal / ORTPSA framing |
| 3 | `pilot_state_code` | `IN-OD` | ISO-3166-2 |
| 4 | `legal_basis` | ORTPSA/ORTPS notified Resident Certificate service — Revenue & Disaster Management Department | Portal; no invented Act section |
| 5 | `eligibility_rules` | Continuous residence ≥ 12 months in concerned Tahasil; relaxations for transferred govt employee / woman married within past 1 year | Portal |
| 6 | `evidence_requirements` | Any one/more: electricity bill, ROR, EPIC/Aadhaar, landline, water bill, ration card, holding tax, lease, employer certificate, bank passbook page 1, voter list extract, NREGA job card, other relevant | Portal |
| 7 | `fee_schedule` | Government service charge = ₹0 | Portal |
| 8 | `sla_processing_days` | 10 working days | Portal |
| 9 | `sla_start_anchor` | `APPLICATION_SUBMITTED` | Lab mapping of portal “after application” SLA |
| 10 | `credential_template_id` | `SAMPLE_LAB_IND_SOC_002_OD_RESIDENT_V1` | SAMPLE_LAB (not DigiLocker-registered) |
| 11 | `issuing_authority` | Tahasildar (concerned Tahasil) | Portal jurisdiction language |
| 12 | `notification_template` | `SAMPLE_LAB` SMS/email IDs in overlay | SAMPLE_LAB (DLT PE-ID not published on portal) |

## Fail-closed behaviour (remaining)

Any runtime path that requires a **production** DigiLocker binding or DLT PE-ID MUST still refuse PRODUCTION until those registrations exist. Lab golden path may use SAMPLE_LAB under LOCAL/CI/SIT only.
