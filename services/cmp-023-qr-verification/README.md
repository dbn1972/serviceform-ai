# CMP-023 QR Verification Service

SF-M07-003. Opaque QR verification tokens for ISSUED credentials, bound to the FROZEN
`SF-CON-VERIFICATION-TOKEN` contract (INT-008).

- **Opaque token.** 32 random bytes, base64url (43 characters). It is not derived from and does
  not encode the credential, tenant or holder. It is never written to events or audit; audit uses
  a one-way `token-ref:` hash.
- **Registry status is read-only.** `registry_status` is read live from CMP-024 through
  `RegistryStatusPort` (single `getStatus` read) on every response: mint, issuer read and public
  verify. `sf_qr` has no status column, the repository has no status method, and idempotent
  replays store only the `token_id` and re-render with the status just read. A registry outage
  or malformed/inconsistent answer fails closed (`503 SF-INT-001`); there is no cached fallback.
  Requests that try to supply a status are refused (`400 STATUS_WRITE_FORBIDDEN`).
- **Purpose-minimised public view.** `GET /v1/qr/verify/{opaque_token}` returns only
  `token_purpose`, `status_source_cmp` and the frozen `public_view` (credential type ref, issuer
  ref, issued_at, registry status, status_checked_at, signed artifact hash). No tenant, token or
  credential id, no holder or application data. Unknown, foreign-tenant and expired tokens are
  `404`. All responses are `Cache-Control: no-store`.
- **Minting.** `POST /v1/qr/tokens` (OFFICER / PRIVILEGED_ADMIN / SYSTEM, Idempotency-Key
  required) checks through `CredentialPort` (CMP-022) that the credential is `ISSUED`, takes
  `issuer_ref` from the CMP-024 record, and stores one token per credential. Re-minting returns
  the existing token (`200`); different terms are `409`. Minting never changes the credential.
- **Ports only.** `CredentialPort` (CMP-022), `RegistryStatusPort` (CMP-024),
  `AuthorizationPort` (OPA). No peer imports, no cross-component SQL. Port calls never run inside
  a DB transaction.
- **Tenant safety.** Tenant only from the server-derived request context; tenant headers/body
  fields refused. A port answer for another tenant is blocked (`403 CROSS_TENANT_RECORD_BLOCKED`,
  audited). FORCE RLS on every tenant table; runtime via `sf_cmp023_rw` (NOLOGIN, NOSUPERUSER,
  NOBYPASSRLS) + `sf_app`. Token rows are insert-only.
- **No invented periods.** `expires_at` is optional and only taken from the issuing caller
  (approved metadata). No validity or retention period is defined here.

Every route is a PEP call on OPA (`QR_TOKEN_ISSUE`, `QR_TOKEN_READ`, `QR_TOKEN_VERIFY`); denials
are audited `DENIED`, post-authorization refusals `FAILED`. The public verifier is whatever
server-derived context the host builds (tenant from routing, `auth_assurance` `NONE`); OPA decides.

Routes: `contracts/openapi.json`. Events: `contracts/asyncapi.json`. Host mount is deferred to
SF-M07-005; no UI.
