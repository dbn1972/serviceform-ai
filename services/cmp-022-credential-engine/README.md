# CMP-022 Credential Engine

Generates, signs and issues credentials for approved applications (Eng v1.4 CMP-022; INT-008,
INT-011, INT-013). Produces `SF-CON-CREDENTIAL` v1 and `SF-CON-SIGNING-RECORD` v1 (FROZEN,
`contracts/m07/schemas/`).

Status: SF-M07-001 builder output. Not CERTIFIED, not G3, not G6. Host mount deferred to SF-M07-005.

## Ownership (schema `sf_credential`, role `sf_cmp022_rw`, ADR-0006)

CMP-022 owns credential rows, artifact references, signing attempts and downstream outcomes. It
makes **no approval decision** (`approval_decision_by_this_component = false`, enforced by a CHECK):
issuance requires an upstream approval reference already recorded on the case. Artifacts are stored
as storage-key + SHA-256 references only; no document bytes or personal data are held here.

| Input | Source (port) | Pin |
|---|---|---|
| TSB, service version, credential template + version, approval decision ref | Case pins (`CaseIssuancePinsPort`) | SF-CON-VERSION-PINNING |
| Unsigned render | `ArtifactRenderPort` | template version |
| Signature | `SigningPort` (CMP-037, INT-013 REAL / SANDBOX / SIMULATED) | connector binding |
| Registry entry | `CredentialRegistryPort` (CMP-024) | credential id |

Clients may send only `{ application_id, issuance_key }`. Pins, approval, artifacts, signing or
registry fields are refused (`CLIENT_AUTHORITY_FORBIDDEN`), as are client timestamps. Unbound ports
fail closed (`SF-SYS-004`).

## Lifecycle

`GENERATED → SIGNED → ISSUED`, forward only, enforced in code and by database triggers (`55000`,
mapped to `SF-APP-001`). Provenance columns are immutable; artifacts, signing records and outcomes
are insert-only (`42501`).

- The credential id is deterministic from (tenant, application, `issuance_key`), so a repeat or
  concurrent request converges on one credential; port calls carry deterministic idempotency keys.
- Issuance is resumable: each step is its own transaction, and a retry continues from the stored
  state. A failed signing attempt is recorded and the next attempt number is used on retry.
- `SIGNED` requires a `SIGNED` signing record whose artifact hash matches the signed artifact.
- `ISSUED` requires a CMP-024 registry acknowledgement of `REGISTERED` or `ACTIVE`.
- SIMULATED signing needs a simulation marker bound to the connector binding and to the deployment
  environment; it is refused in PRODUCTION (code and CHECK). The default environment is PRODUCTION.

DigiLocker publication and notification outcomes are recorded append-only against an `ISSUED`
credential and never change its lifecycle; a failed publish leaves the credential `ISSUED`.

## Transactions

No port call happens inside a transaction (an `inTransaction()` guard throws `NETWORK_IN_TX`).
Each transaction writes state, its domain outbox event (`sf.credential.events.v1`) and its audit
event (`sf.audit.ingest.v1`). The HTTP idempotency record is claimed in the final transaction.

## API (component-local `contracts/openapi.json`)

- `POST /v1/credentials` `{ application_id, issuance_key }` (Idempotency-Key required) → 201 / 200
- `GET /v1/credentials/{credential_id}`
- `GET /v1/credentials/{credential_id}/signing-records`
- `POST /v1/credentials/{credential_id}/downstream-outcomes`
- `GET /v1/applications/{application_id}/credentials`

Events: `CredentialGenerated`, `CredentialSigned`, `CredentialSigningFailed`, `CredentialIssued`.

## Tests

`pnpm --filter @serviceform/cmp-022-credential-engine test:unit` and `test:integration`
(`DATABASE_URL` required). The package declares no dependencies.
