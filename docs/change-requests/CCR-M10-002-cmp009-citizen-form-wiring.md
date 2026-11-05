# CCR-M10-002: CMP-009 dynamic forms on the citizen portal path

| Field | Value |
|---|---|
| Status | **IMPLEMENTED for SAMPLE_LAB** under Debabrata Nayak's "DO IT" for the forms engine and template catalogue (5 November 2026). Production stays refused while ADR-0007 is PROPOSED |
| Change class | **Additive, non-breaking.** No FROZEN lock row changes. CMP-009 OpenAPI operations, schemas and events are unchanged |
| Components | CMP-009 Dynamic Forms (`services/cmp-009-dynamic-forms`), OPA bundle (`policy/opa`), platform host (`apps/api/src/platform`), citizen BFF (`apps/web-citizen`) |
| Related | CCR-M10-001 follow-up ("bind SUBMIT to a VALID CMP-009 execution"), ADR-0007 D-2 (citizen-owner path), ADR-0005 (policy revision) |

## Why

The citizen apply page was a hand-built four-step wizard and the BFF checked a hard-coded shape.
CMP-009 existed but was not mounted on the platform host, and a citizen could not call it: the
OPA catalogue had no `FORM_*` actions, so every request failed closed with `UNKNOWN_ACTION`.

## Change

### 1. OPA bundle (`m10-b1` → `m10-b2`)

- Actions `FORM_INTERPRET` (READ_ONLY), `FORM_EXECUTION_EXECUTE` (PROTECTED), `FORM_EXECUTION_READ`
  (READ_ONLY); resource types `FormDefinition`, `FormExecution`.
- Citizen-owner grant `FormExecution: [FORM_EXECUTION_EXECUTE]` (OTP/MFA). CMP-009 now sends
  `owner_id = actor.id` for execute: a new execution belongs to its requester.
- New `citizen_published_grants` path: `FormDefinition: [FORM_INTERPRET]` (OTP/MFA). The resource is
  the tenant's published form, so there is no owner. Tenant match, onboarded-tenant data, the
  no-roles rule and assurance still apply.
- Citizens get no `FORM_EXECUTION_READ`: executions carry other citizens' data hashes.
- 12 new Rego tests (`forms_citizen_test.rego`); 80/80 pass.

### 2. CMP-009 runtime

- **Bounded `pattern` subset.** Anchored patterns of character classes, `\d`, and literals with
  `{n}`, `{n,m}` (≤ 64) or `?`; ≤ 32 tokens, ≤ 128 chars. Matching uses no RegExp engine: a
  position-set walk that stays linear in input length. Anything else is refused when the form is
  parsed (`SCHEMA_PATTERN_UNSUPPORTED`), so an author learns at publish time instead of a citizen at
  submit time. New issue code `PATTERN`.
- **Nested required.** An interpretation now marks a nested control required only when every
  object on its path requires the next name (previously only root `required` names counted, so
  `residence_address.pincode` was reported optional while validation required it).

### 3. Platform host

- CMP-009 mounted (M04 composition) with its own runtime login `sf_lab_cmp009` (`sf_cmp009_rw`
  only, ADR-0006), the placement context resolver and real OPA.
- Published forms come from a **SIMULATED publication** of the Studio template catalogue
  (`@serviceform/service-templates`). The host refuses to start unless each offered binding's
  `form_version_id` is a PUBLISHED catalogue version whose recorded content hash still matches its
  form. CMP-052 publication replaces this in slice B-4.

### 4. Citizen BFF

- `GET /api/portal/forms/{catalogueId}` returns the pinned package and its CMP-009 interpretation;
  `POST` re-interprets for rule-condition changes. 404 for services the placement does not offer.
- `POST /api/portal/applications` takes `{ catalogue_id, data }` (a bare object is read as
  IND-SOC-002 data). Order: SAMPLE_LAB synthetic-name refusal on person-name semantic fields →
  **CMP-009 execution (authoritative)** → CMP-015 draft → the draft must pin the validated form
  version → working data → CMP-015's stored `data_hash` must equal CMP-009's `data_hash` →
  MARK_READY_TO_SUBMIT → SUBMIT. Invalid data returns 422 with `field_errors` and files nothing.

## Not changed / follow-ups

- CMP-015 does not yet verify the execution itself on SUBMIT (the BFF enforces the binding). A
  CMP-015 `FormValidationPort` check is the remaining CCR-M10-001 follow-up.
- CMP-008 eligibility stays unbound; the review step shows an indicative, non-blocking pre-check
  from template metadata and says the officer decides.
- Rate limiting for CMP-009 is per BFF address, like CMP-004 (SEC F-08).
- Independent suites that assert `m10-b1` or post the old flat body without the new required
  fields (`tests/integration/m10-platform`, `tests/security/m10`, not in CI) need their owners to
  refresh them.

Not CERTIFIED. G6 not affected. DigiLocker stays SIMULATED.
