# M07 contracts (FROZEN_CANDIDATE)

Status of every artifact in this directory: **FROZEN** in the freeze candidate tree.

This is the SF-M07-CG-001 freeze preparation (LOCK-2, authorized by
`HUMAN_M07_THROUGH_EVD_AUTHORIZATION`). It appends five NEW rows to
`orchestrator/contracts-lock.yaml` (lock v2.6). Repository freeze is **not** effective until this
branch merges to `origin/main`. Wave A is **not** eligible. Builders remain OFF.

The existing 29 frozen contracts (13 shared + 6 M05 + 5 M06 + 5 M08) remain FROZEN and unmodified.

| ID | File | Owner | Subject |
|---|---|---|---|
| SF-CON-CREDENTIAL | `schemas/credential.schema.json` | CMP-022 | Issuance record: GENERATED/SIGNED/ISSUED, version/template pins, artifact hash refs, issuance_key |
| SF-CON-SIGNING-RECORD | `schemas/signing-record.schema.json` | CMP-022 | Signing adapter attempt via CMP-037; INT-013 mode; retry-safe |
| SF-CON-CREDENTIAL-STATUS | `schemas/credential-status.schema.json` | CMP-024 | Authoritative registry status + append-only history |
| SF-CON-VERIFICATION-TOKEN | `schemas/verification-token.schema.json` | CMP-023 | Opaque QR token; purpose-minimised public view; status read-only |
| SF-CON-DIGILOCKER-PUBLISH | `schemas/digilocker-publish.schema.json` | CMP-012 | Consent/purpose-bound publish of an ISSUED credential; INT-013 mode |

## Invariants encoded

- CMP-022 never makes the approval decision (`approval_decision_by_this_component: false`); it references the upstream workflow/human decision.
- Issuance is not reversed by publish or notification failure (`issuance_reversible_by_publish_failure`, `issuance_reversible_by_notification_failure`, `issuance_reversed_on_publish_failure` are const `false`; publish never changes registry status).
- CMP-024 is the only registry status authority. CMP-023 reads status (`registry_status_read_only`, `status_write_forbidden`).
- INT-013 connectors declare `connector_mode` REAL | SANDBOX | SIMULATED. `simulation_marker` (frozen SF-CON-SIMULATION-MARKER) is required when SIMULATED and forbidden otherwise.
- Suspension/revocation reasons, document types, issuer and credential type identifiers are opaque metadata refs. No DigiLocker or eSign statutory policy is defined here.

Catalog: `catalog.json`. Examples: `examples/valid`, `examples/invalid` (every contract has both).
Validate with `node evidence/SF-M07-CG-001/validate-m07-schemas.mjs` (does not mutate `packages/contracts`).
