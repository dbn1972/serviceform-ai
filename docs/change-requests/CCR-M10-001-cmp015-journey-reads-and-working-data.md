# CCR-M10-001: CMP-015 journey reads and application working data

| Field | Value |
|---|---|
| Status | **APPROVED FOR IMPLEMENTATION** under Debabrata Nayak's Phase B authorization ("freeze/update journey contracts as needed; CCR if breaking") |
| Change class | **Additive, non-breaking.** No FROZEN lock row changes (SF-CON-APPLICATION-CASE-SM, SF-CON-COMMAND-TRANSITION, SF-CON-VERSION-PINNING hashes unchanged) |
| Component | CMP-015 Application / Case (`services/cmp-015-application-case/contracts/openapi.json`) |
| Raised by | Phase B platform-wiring agent (SF-M10-B-1), 4 November 2026 |
| Related | ADR-0007 (citizen tenant context), Phase A finding L-1/L-2, AWS v1.7 CMP-015 |

## Why

AWS v1.7 makes CMP-015 the "system of record for citizen applications" with "mutable working
data separated" and a "case summary" API. On `main` `4df2a0b` CMP-015 stores only ids and version
pins and has get-by-id only. CMP-009 deliberately stores only a hash of form data. So:

1. no component holds what the applicant submitted (the lab JSON file was the only copy);
2. a citizen cannot list their own applications, and an officer cannot list a tenant queue,
   without the lab store.

## Change

### 1. `GET /v1/applications` — `listApplications`

| Caller | Rows returned | OPA action / resource |
|---|---|---|
| CITIZEN | Only rows where `applicant_id = actor.id`, inside the RLS tenant | `APPLICATION_LIST`, `owner_id = actor.id` (citizen-owner path) |
| OFFICER / SYSTEM | Tenant rows, optional `state` filter | `APPLICATION_LIST`, no owner (role path) |

Query: `state` (one `CaseState`, optional), `limit` (1–100, default 50). Order: `created_at DESC`.
Response `{ "applications": Application[] }`. Ownership filtering is in SQL, not post-filtering.

### 2. `PUT /v1/applications/{applicationId}/working-data` — `putApplicationWorkingData`

Body `{ form_version_id, data, expected_revision }`.

- `form_version_id` must equal the case's pinned `form_version_id` (else `SF-FORM-001`).
- `data` is a JSON object, ≤ 64 KiB serialized. Stored as given. `data_hash` = canonical SHA-256.
- Writable only while the case is `DRAFT` or `DEFICIENCY_RAISED` (else `SF-APP-001`).
- Optimistic concurrency: `expected_revision` must equal the current revision (0 when absent),
  else `SF-APP-001` with detail `STALE_REVISION` (no new error code; the shared catalogue is
  FROZEN). Revision increments by 1. Idempotency-Key required.
- OPA action `APPLICATION_WORKING_DATA_WRITE` on the case resource (owner = applicant).
- Audit records the hash and revision only, never field values. No domain event carries values.

### 3. `GET /v1/applications/{applicationId}/working-data` — `getApplicationWorkingData`

Returns `{ application_id, revision, form_version_id, data, data_hash, updated_at }`.
OPA action `APPLICATION_WORKING_DATA_READ`. 404 `SF-SYS-002` when absent or not visible.

### Storage

New table `sf_application_case.application_working_data` (TENANT_SCOPED, FORCE RLS, `sf_cmp015_rw`
DML only, PUBLIC revoked, owner `sf_migrator`). Classified `pii=CITIZEN_SUPPLIED`. One row per
application; revision column; FK to `application_case`. Retention follows the case (CMP-049 policy
binding is a follow-up; no retention period is invented here).

## Out of scope / follow-ups

- Binding SUBMIT to a VALID CMP-009 execution whose `data_hash` matches (schema validation of
  working data). Until then the BFF validates the SAMPLE_LAB form shape.
- Cross-tenant citizen view (needs the Tenant Isolation §10 citizen↔tenant relationship).
- Field-level encryption of working data (KMS envelope) — security review item.

## Compatibility

Existing operations, schemas, events and state machine unchanged. Consumers that ignore the new
operations are unaffected. Not CERTIFIED. G6 not affected.
