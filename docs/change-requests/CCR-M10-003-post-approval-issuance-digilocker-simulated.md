# CCR-M10-003: post-approval issuance and SIMULATED DigiLocker publish on the platform path

| Field | Value |
|---|---|
| Status | **IMPLEMENTED for SAMPLE_LAB** (Phase B slice B-3) under Debabrata Nayak's authorization to complete pending Phase B slices. LOCAL/CI only; PRODUCTION and every other environment are refused |
| Change class | **Additive, non-breaking.** No FROZEN lock row changes (`orchestrator/contracts-lock.yaml` untouched; `contracts/m07/schemas/digilocker-publish.schema.json` unchanged). One new CMP-012 read operation; one new SAMPLE_LAB host route |
| Components | CMP-022 Credential Engine, CMP-024 Credential Registry, CMP-012 DigiLocker (`services/cmp-012-digilocker`), CMP-015 Application/Case (unchanged; used through its service), OPA bundle (`policy/opa`), platform host (`apps/api/src/platform`), citizen and officer BFFs |
| Integration | INT-008 wiring pattern (SIMULATED render/eSign bridges), INT-013 SIMULATED eSign marker, CMP-012 SIMULATED publish connector |
| Related | CCR-M10-001, CCR-M10-002, ADR-0005 (policy revision), ADR-0006 (one runtime login per component), ADR-0007 (portal placement; still PROPOSED) |
| Honesty | SIMULATED only. **Not CERTIFIED. G6 not issued. No REAL DigiLocker. self_certified=false** |

## Why

After an officer's HUMAN approval the platform path stopped at `APPROVED`: CMP-022/024/012 were not
mounted on the SAMPLE_LAB host, the OPA catalogue had no credential or DigiLocker actions (every
call failed closed with `UNKNOWN_ACTION`), and the citizen portal hard-coded
`digilocker.status = NOT_REQUESTED`.

## Change

### 1. OPA bundle (`m10-b2` → `m10-b3`)

- Actions `CREDENTIAL_ISSUE` (PROTECTED), `CREDENTIAL_READ` (READ_ONLY),
  `CREDENTIAL_DOWNSTREAM_OUTCOME_RECORD` (PROTECTED), `CREDENTIAL_REGISTRY_REGISTER` (PROTECTED),
  `CREDENTIAL_REGISTRY_STATUS_READ` (READ_ONLY), `digilocker:publish` (PROTECTED),
  `digilocker:read` (READ_ONLY); resource types `Credential`, `CredentialRegistryEntry`,
  `DigiLockerPublish`.
- **Role grants only.** No citizen-owner or published grant: citizens never call CMP-022/024/012.
- SAMPLE_LAB tenant data gains role `SAMPLE_LAB_ISSUANCE_WORKLOAD` (tenant-wide) for the host's
  SYSTEM workload: the case reads and `APPLICATION_ENTER_SIGNING_PENDING` /
  `APPLICATION_RECORD_ISSUED`, plus the actions above.
- New `issuance_workload_test.rego`; 87/87 Rego tests pass.

### 2. CMP-012 (additive read)

- `GET /v1/digilocker-publish?credential_id=<uuid>` → `{ credential_id, publish_records[] }`, newest
  first, at most 50, inside the caller's tenant (RLS + `assertTenant`), guarded by
  `digilocker:read` with the credential id as the resource. Repository method
  `listPublishRecordsForCredential`. Existing operations, schemas and events are unchanged.

### 3. Platform host (`apps/api/src/platform/issuance.ts`, `runtime.ts`)

- CMP-022, CMP-024 and CMP-012 composed with their PostgreSQL repositories and mounted through
  M07 (CMP-023 QR is not mounted). Each has its own runtime login (`sf_lab_cmp022` →
  `sf_cmp022_rw`, `sf_lab_cmp024` → `sf_cmp024_rw`, `sf_lab_cmp012` → `sf_cmp012_rw`; NOSUPERUSER,
  NOBYPASSRLS). The bootstrap creates or updates logins in one guarded `pg_roles` `DO` block (no
  `CREATE ROLE IF NOT EXISTS`).
- Connector stand-ins, all SIMULATED: render (stored reference + digest, no bytes), INT-013 eSign
  (simulation marker carries the lab environment, so CMP-022 refuses it elsewhere), DigiLocker
  binding (`mode SIMULATED`, `critical true`, `secret_ref null`) with
  `SimulatedDigiLockerConnector`. CMP-012's binding policy refuses a critical non-REAL binding in
  PRODUCTION independently of the host.
- CMP-024 registration goes through CMP-024's own transport, so CMP-024 fingerprints and replays
  the request itself.
- `POST /v1/applications/:applicationId/issuance` (officer only, empty body) runs, as the tenant
  SYSTEM workload (`WORKLOAD_IDENTITY`):
  `ENTER_SIGNING_PENDING` → CMP-022 issue (approval reference = the CMP-015 `RECORD_APPROVED`
  transition by an **OFFICER**, i.e. the HUMAN decision) → `RECORD_ISSUED` → CMP-012 publish →
  CMP-022 downstream outcome. Idempotency keys derive from the application or credential id, so a
  retry resumes instead of duplicating. A step failure is reported (`issuance_error.step`) and
  never compensated; **a publish failure never reverses the issued credential**.
- `GET /v1/applications/:applicationId/issuance` projects `{ case_state, credential, digilocker }`
  for whoever CMP-015 lets read the case (citizen owner or officer); only then does the workload
  read CMP-022/012. `simulation: true`, `g6_issued: false`.
- The host neither decides nor evaluates eligibility; WorkflowAdvancePort is not used (B-2c
  binds it to Temporal).

### 4. SAMPLE_LAB fixture (`fixtures/lab/platform/issuance.json`)

Labelled `SIMULATED`. Workload actor, issuer ref, connector binding ids, credential template pin,
and a **synthetic** CMP-030 stand-in `consent_ref` + `purpose_code SAMPLE_LAB_CREDENTIAL_PUBLISH`
for publish until the B-2d profile/consent path exists. No personal data.

### 5. Portals

- Officer BFF: after APPROVE is recorded, requests issuance; `ISSUE` retries an approved case.
  The approval stands whatever issuance returns.
- Citizen BFF: projects `credential_id` and the CMP-012 status for cases past approval; a refusal or
  outage reads as `NOT_REQUESTED`. UX4G copy states SIMULATED DigiLocker and G6 not issued.

## Not changed / follow-ups

- REAL or SANDBOX DigiLocker, CMP-037 connector registry, CMP-030 consent (B-2d), CMP-016 / Temporal
  sequencing (B-2c), Studio CMP-052 publication (B-4), CMP-023 QR on the platform path.
- Publish retry scheduling: a failed publish is retried only when an officer re-requests issuance.
- Pre-existing platform INT failures on `origin/main` (stale `m10-b1` revision expectations,
  INT-005 posture assertions, three BFF-seam cases) are untouched; see `evidence/SF-M10-B-3`.
