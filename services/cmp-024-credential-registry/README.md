# @serviceform/cmp-024-credential-registry

CMP-024 Credential Registry / Revocation (SF-M07-002). Authoritative writer of credential registry
status under the FROZEN contract `SF-CON-CREDENTIAL-STATUS`; CMP-023 (QR verification) and other
consumers only read it.

## Lifecycle

| Command   | From                         | To                   | Requires                           |
| --------- | ---------------------------- | -------------------- | ---------------------------------- |
| register  | (none)                       | REGISTERED           | SYSTEM workload, opaque issuer_ref |
| activate  | REGISTERED                   | ACTIVE               |                                    |
| suspend   | ACTIVE                       | SUSPENDED            | `reason_code_ref`                  |
| reinstate | SUSPENDED                    | ACTIVE               |                                    |
| revoke    | REGISTERED, ACTIVE, SUSPENDED | REVOKED (terminal)  | `reason_code_ref`                  |
| reissue   | ACTIVE, SUSPENDED            | REISSUED (terminal)  | live successor in same tenant      |

`reason_code_ref` is an opaque reference to an approved reason in tenant metadata. This component
defines no statutory revocation grounds, validity periods or eSign/DigiLocker policy. Every change
appends one immutable history entry; the database rejects UPDATE/DELETE of history, refuses
illegal or terminal transitions, and requires each history row to match the entry version it
records. Issuance (CMP-022) is never reversed by anything here.

## Read ports never mutate

`GET /v1/credential-registry/credentials/{credential_id}/status` is the only read route. It accepts
no body and no query parameters, receives only the `CredentialStatusReader` capability, and runs in
a `BEGIN READ ONLY` transaction through a repository view with no mutators.
`createCredentialStatusReadPort()` gives in-process consumers a frozen `{ getStatus }` object.

## Isolation and security

Schema `sf_credential_registry`, privilege role `sf_cmp024_rw` (NOLOGIN, NOBYPASSRLS), FORCE RLS on
every tenant table via `sf_platform.current_tenant_id()`. Tenant comes from the server-derived
request context only; tenant headers and body `tenant_id` are refused. Every route is an OPA PEP
call made before any transaction opens; denials are audited, PDP outages fail closed.

## Tests

```bash
pnpm --filter @serviceform/cmp-024-credential-registry run typecheck
pnpm --filter @serviceform/cmp-024-credential-registry run test:unit
DATABASE_URL=postgres://... pnpm --filter @serviceform/cmp-024-credential-registry run test:integration
```

Host mount is deferred to SF-M07-005.
