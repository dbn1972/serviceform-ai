# IND-SOC-002 sample policy provenance — Odisha Resident Certificate

**Human authorization (2026-10-17):** use a publicly available state reference service / web form as sample owner input for the M10 golden path.

| Field | Value |
|---|---|
| State | Odisha (`IN-OD`) |
| Public portal | https://edistrict.odisha.gov.in/ |
| Service name on portal | Resident Certificate |
| Line department | Revenue and Disaster Management Department |
| Service framing on portal | ORTPS / ORTPSA (Odisha Right to Public Services) notified service |
| Retrieved | 2026-10-17 via public portal fetch |

## Published facts used (portal text)

1. **Eligibility:** Resident Certificate for a locality in the State shall be issued to a person who has been residing continuously for a period of at least one year within the jurisdiction of the concerned Tahasil; may be relaxed for government employees who have been transferred and women who have been married within the past one year.
2. **SLA:** In 10 working days the service will be delivered.
3. **Fee:** There is no Government Service charge for this service.
4. **Evidence (any one / more as per requirements):** Electricity Bill; Copy of ROR; Epic / Aadhaar card; Landline Telephone Bill; water connection bill; Ration Card; Holding Tax Receipt; Lease agreement with house owner; Certificate from the Employer; First page of bank passbook; Extract of latest voter list; NREGA job card; other relevant documents.

## Lab-only samples (not on the portal — clearly marked)

- DigiLocker document type / credential template registration ID
- SMS DLT PE-ID / template IDs
- Synthetic pilot `tenant_id` UUID and maker/checker actor UUIDs (no real officer names)
- Pin-graph version stamps for Studio publish fixture

These use `SAMPLE_LAB_*` values so the golden harness can run. They are **not** production DigiLocker/DLT registrations.

## Non-claims

CERTIFIED=false · G6 not self-issued · invented Act section numbers=false · no real PII · production REAL DigiLocker/payment not claimed.
