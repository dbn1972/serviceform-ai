# CCR-M10-004: CMP-005 citizen profile and CMP-030 consent on the SAMPLE_LAB platform path

| Field | Value |
|---|---|
| Status | **PROPOSED** (builder slice M10-B-2d). Needs human/CI review. Production stays refused while ADR-0007 is PROPOSED |
| Change class | **Additive, non-breaking.** No FROZEN lock row changes. CMP-005 and CMP-030 OpenAPI operations, schemas and events are unchanged. `SF-CON-PORTAL-SESSION` is unchanged (the cookie still carries only the opaque CMP-004 token) |
| Components | CMP-005 Citizen Profile, CMP-030 Consent & Privacy, CMP-004 Identity (subject directory), OPA bundle (`policy/opa`), platform host (`apps/api/src/platform`), citizen BFF (`apps/web-citizen`) |
| Related | ADR-0006 (one runtime login per component), ADR-0007 D-1/D-2 (placement-derived citizen context, citizen-owner path), CCR-M10-002 (CMP-009 wiring), Constitution §38 (semantic elements) |

## Why

The citizen portal showed `Verified citizen` for everyone, the apply form pre-filled
`SAMPLE Lab Citizen` from the template sample data, and the certificate page showed Mobile as `—`.
CMP-005 and CMP-030 existed but were not mounted on the platform host, and the OPA catalogue had no
profile or consent actions, so every call would have failed closed with `UNKNOWN_ACTION`.

## Change

### 1. OPA bundle (`m10-b3` → `m10-b2d`)

- Actions: `PROFILE_READ` (READ_ONLY), `PROFILE_WRITE`, `PROFILE_IMPORT_VERIFIED`, `PURPOSE_CREATE`,
  `PURPOSE_READ` (READ_ONLY), `NOTICE_CREATE`, `NOTICE_PUBLISH`, `CONSENT_GRANT`, `CONSENT_READ`
  (READ_ONLY), `CONSENT_WITHDRAW`, `PRIVACY_ACCESS_CHECK` (READ_ONLY). Resource types
  `CitizenProfile`, `Purpose`, `PrivacyNotice`, `Consent`.
- Citizen-owner grants (OTP/MFA): `CitizenProfile: [PROFILE_READ, PROFILE_WRITE]`,
  `Consent: [CONSENT_GRANT, CONSENT_READ]`. Published grant: `Purpose: [PURPOSE_READ]`.
- Citizens get no `PRIVACY_ACCESS_CHECK`, `PROFILE_IMPORT_VERIFIED` or `CONSENT_WITHDRAW` grant in
  this slice. Withdrawal through the portal is a follow-up.
- `CITIZEN_PRIVATE` tenant rule (`sf/authz/tenant.rego`): a null subject tenant or a null resource
  tenant is now a mismatch, and onboarded-tenant data is required. Before, a missing tenant on
  either side could fall through to the role layer.
- Lab tenant roles (`fixtures/lab/platform/opa`): `SAMPLE_LAB_CONSENT_GATE`
  (`PRIVACY_ACCESS_CHECK` on `Consent`) and `SAMPLE_LAB_PRIVACY_PUBLISHER` (purpose and notice
  create/read/publish). Both are host SYSTEM workloads; neither can grant consent or read a profile.
- `profile_consent_test.rego`: 15 tests. The bundle passes 108/108.

### 2. PDP input from CMP-005 and CMP-030 (no HTTP contract change)

- CMP-005 `authorizeProfile` and CMP-030 `decide` now send `subject.assurance` from the request
  context, so the OTP/MFA requirement on citizen grants can be evaluated.
- CMP-030 now sends `resource.owner_id = subject_id` for `CONSENT_GRANT`, `CONSENT_READ` and
  `PRIVACY_ACCESS_CHECK`, so the citizen-owner layer can match the actor to the data subject.
- CMP-030 refuses a citizen consent grant whose `representation_basis` is not `SELF`
  (`403 SF-AUTH-002`, detail `CITIZEN_SELF_ONLY`); assisted and legal-representative consent
  stays with officers.

### 3. CMP-004 subject directory

- `PgCitizenSubjectDirectory.exists` answers CMP-005's `SubjectDirectoryPort` from CMP-004's own
  pool and table (`sf_identity.citizen_principal`, ACTIVE only). No cross-component SQL.

### 4. Platform host

- CMP-005 (`sf_lab_cmp005` → `sf_cmp005_rw`) and CMP-030 (`sf_lab_cmp030` → `sf_cmp030_rw`) get
  their own runtime logins and pools, and readiness checks `cmp005-db` and `cmp030-db`.
- CMP-030 is mounted through `wave2.consentPrivacy`. CMP-005 is mounted through
  `m02.citizenProfile`. Both use the placement context resolver and real OPA.
- `ConsentAccessPort` → CMP-030: an internal, non-listening CMP-030 Fastify instance reached by
  `inject` (no network, no cross-component SQL). It accepts only in-memory workload tokens for the
  consent gate and the privacy publisher; OPA still decides every action. A foreign tenant is
  refused before any call.
- SIMULATED privacy publication: on `start()` the host creates the purposes in
  `fixtures/lab/platform/consent.json` and publishes their notices, with stable idempotency keys.
  Without a notice read route, a `409 SF-APP-002` on the notice version of an already existing
  purpose is taken as already recorded, so the host still starts once CMP-030's idempotency
  records are gone.
- The CMP-005 DigiLocker binding is SIMULATED. Verified import is not used in this slice.

### 5. Citizen BFF

- Session summary: `display_name` comes from the consented CMP-005 `IDENTITY.DISPLAY_NAME` claim,
  `masked_mobile` from `IDENTITY.CONTACT_PHONE`. Without a profile the name is `Citizen` and the
  mobile is `null`. Identity is still derived from CMP-004 on every request.
- Register collects a synthetic display name, the mobile and consent, validated by
  `validateLabRegistration` before any OTP is sent. After OTP verify the BFF: PUT profile →
  resolve the ACTIVE purpose → POST `/v1/consents` (`SELF`, `WEB`; 409 `SF-APP-002` reuses the
  consent already held) → PUT claims. If any step fails the new session is revoked and the citizen
  is asked to request a new OTP.
- Apply prefill overlays profile claims on fields bound to semantic element ids
  (`SF-SEM-PERSON-FULL-NAME` ← DISPLAY_NAME, `SF-SEM-PERSON-MOBILE` ← CONTACT_PHONE). In SAMPLE_LAB
  a claim that fails the synthetic-name or synthetic-mobile rule is dropped. The response reports
  `prefill_source`.

## Proposed additive contract changes (not implemented)

1. **CMP-030 notice discovery.** `GET /v1/privacy/notices?purpose_id=` returning the current
   PUBLISHED notice id and version. Consents are granted without `notice_id` today because a
   citizen cannot discover it. This is additive to CMP-030's OpenAPI and needs a CCR approval before
   implementation.
2. **Verified contact channel.** `CONTACT_PHONE` is written as `source_kind = SELF`,
   `verification_status = UNVERIFIED`. The BFF cannot prove that the number equals the CMP-004 OTP
   channel, so the portal no longer labels it "verified". Binding it needs either a CMP-004
   introspection field for the verified channel (masked or hashed) or a CMP-005 import from CMP-004.
   Either is a contract change for a later slice.

## Not changed / follow-ups

- No consent withdrawal UI, privacy centre (CMP-061) or retention (CMP-049) wiring.
- Profile rate limiting is per BFF address, like CMP-004 and CMP-009 (SEC F-08).
- `tests/integration/m10-platform/bff-seam.test.ts`: the same five pre-existing failures as on
  `main` after B-2c/B-3 (catalogue-scoped apply body and status-mapping drift); not caused here.

Not CERTIFIED. G6 not affected. DigiLocker stays SIMULATED.
