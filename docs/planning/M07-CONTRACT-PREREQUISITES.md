# M07 contract prerequisites (PROPOSED — do not freeze in this PR)

**Status:** `PROPOSED` / `CONTRACT-GUARDIAN-REVIEW-REQUIRED`.  
**This PR does not freeze anything.**  
`M07_CONTRACT_FREEZE_REQUIRED=true`.

SF-M07-CG-001 runs **after** planning merge and **before** Wave A, under freeze authorization (covered by `HUMAN_M07_THROUGH_EVD_AUTHORIZATION` for LOCK-2). Later CG may freeze **NEW** M07 contracts only.

Existing lock: **29/29 MATCH**. MUST NOT silently modify the current 29 frozen contracts. If any must change: **CCR + STOP**.

## Consume as-is (FROZEN)

| ID | Why M07 needs it |
|---|---|
| SF-CON-COMMON / REQUEST-CONTEXT / AUTHZ-DECISION | IDs, inbound context, OPA on commands |
| SF-CON-ERROR-RESPONSE / ERROR-CATALOGUE | fail-closed API (`SF-CRED-*`) |
| SF-CON-EVENT-ENVELOPE / OUTBOX / IDEMPOTENCY | CredentialIssued/Revoked; DigiLocker publish; exactly-once effects |
| SF-CON-AUDIT-EVENT / ISOLATION-DECLARATION / DB-SESSION-CONTEXT | tenant RLS, audit |
| SF-CON-CONNECTOR-BINDING / SIMULATION-MARKER | DigiLocker/eSign INT-013 modes |
| SF-CON-APPLICATION-CASE-SM / WORKFLOW-MODEL / COMMAND-TRANSITION / HUMAN-TASK | approval → signing path (consume) |
| SF-CON-VERSION-PINNING | credential template / service version pins |
| SF-CON-NOTIFICATION-DISPATCH | citizen notify after issue (consume; outage must not undo issuance) |

## NEW M07 contracts (identify now; freeze later via SF-M07-CG-001)

| Proposed ID | Subject | Owning CMP | Required contents |
|---|---|---|---|
| SF-CON-CREDENTIAL | Credential issuance record | CMP-022 | credential_id, application_id, template/version pins, artifact hash refs (storage keys), issuance_key idempotency, status Generated/Signed/Issued; no approval decision by this CMP |
| SF-CON-SIGNING-RECORD | Signing adapter result | CMP-022 (+ CMP-037 port) | signing_record_id, credential_id, connector_binding_id, mode REAL/SANDBOX/SIMULATED, signature_ref/hash, retry-safe; simulation_marker when SIMULATED |
| SF-CON-CREDENTIAL-STATUS | Registry status + history | CMP-024 | status REGISTERED/ACTIVE/SUSPENDED/REVOKED/REISSUED, reason_code ref, immutable history entries, tenant/issuer ownership |
| SF-CON-VERIFICATION-TOKEN | QR / public verify token | CMP-023 | opaque token, purpose-minimized public fields, registry status read-only, no hidden PII |
| SF-CON-DIGILOCKER-PUBLISH | DigiLocker publish request | CMP-012 | consent/purpose refs, credential_id, provider_transaction_ref, connector mode + simulation marker, idempotency; publish failure must not reverse Issued |

## Freeze rules for SF-M07-CG-001 (later; not this PR)

| Field | Value |
|---|---|
| `planned_freeze_write_paths` | `contracts/m07/**`; append-only NEW rows on `orchestrator/contracts-lock.yaml`; `evidence/SF-M07-CG-001/**`; handover |
| `contracts_lock_mode` | `APPEND_NEW_M07_ROWS_ONLY` |
| `existing_29_frozen_contracts_mutable` | **false** |
| `ccr_required_if_existing_contract_change` | **true** |
| `contracts/shared/**` and M05/M06/M08 files | READ-ONLY |

Builders start only after freeze is on `origin/main` **and** READY promotion **and** dispatch record.

## Freeze preparation status (SF-M07-CG-001)

The five NEW contracts above are now **FROZEN_CANDIDATE** on branch `cursor/m07-cg-001-freeze-91f2`
(`contracts/m07/**`, lock v2.6 with 34 rows; the existing 29 rows are unchanged). They are **not**
`FROZEN_ON_MAIN`. The repository freeze takes effect only when that branch merges to `origin/main`
after this planning PR. Evidence: `evidence/SF-M07-CG-001/EVIDENCE.md`.
