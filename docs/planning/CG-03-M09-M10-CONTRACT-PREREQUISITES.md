# CG-03 M09 / M10 contract prerequisites (PROPOSED — do not freeze in this PR)

**Status:** `PROPOSED` / `CONTRACT-GUARDIAN-REVIEW-REQUIRED`.  
**This PR does not freeze anything.**  
`CG_03_CONTRACT_FREEZE_REQUIRED=true`.

SF-M09-CG-001 runs **after** planning merge and **before** Wave A, only after **separate human freeze authorization**. May freeze **NEW** M09 contracts only.

Existing lock: **34/34 MATCH**. MUST NOT silently modify current 34 frozen contracts. If any must change: **CCR + STOP**.

## Consume as-is (FROZEN, do not edit)

All current 34 lock rows (shared + M05 + M06/M08 + M07), including at least:

| Family | Why M09/M10 need it |
|---|---|
| Request/authz/error/event/idempotency/audit/outbox | Every command path |
| Isolation / DB session | FORCE RLS roles |
| Connector binding / simulation marker | INT-013 re-verify |
| Application-case SM / workflow / human-task / SLA | Assisted, risk review, golden case path |
| Credential / verification-token / DigiLocker publish | M10 golden issuance path (consume) |
| Notification / search / retention | Omnichannel notify; discovery; privacy retention orchestration |

## NEW M09 contracts (identify now; freeze later via SF-M09-CG-001)

Proposed IDs are placeholders for guardian review. Paths under `contracts/m09/**`.

| Proposed ID | Subject | Owning CMP |
|---|---|---|
| SF-CON-APPOINTMENT | Appointment / slot booking | CMP-056 |
| SF-CON-ASSISTED-SESSION | Assisted session + representation | CMP-057 |
| SF-CON-SEMANTIC-ELEMENT | Canonical semantic element version | CMP-058 |
| SF-CON-MIGRATION-PROJECT | Migration project / dry-run / reconciliation | CMP-059 |
| SF-CON-RISK-ASSESSMENT | Explainable risk assessment (non-authoritative) | CMP-060 |
| SF-CON-PRIVACY-REQUEST | Citizen privacy rights request / tasks | CMP-061 |
| SF-CON-SFPACKAGE-MANIFEST | Signed `.sfpackage` manifest (no secrets) | cross-cutting |
| SF-CON-BPMN-PROFILE | BPMN 2.0 supported-profile import/export report | cross-cutting |

## M10 schemas

Golden Residence Certificate is **Studio metadata / service package**, not a new backend CMP. Prefer packaging under `templates/residence-certificate/**` and existing FROZEN form/rule/workflow/credential contracts.  
If NEW JSON schemas are required for golden fixtures only, propose under `contracts/m10/**` via SF-M10-CG-001 — **still no invented statute**. Owner fields remain `POLICY_INPUT_REQUIRED`.

## Freeze rules (later; not this PR)

| Field | Value |
|---|---|
| `planned_freeze_write_paths` (M09) | `contracts/m09/**`; append-only NEW rows on `orchestrator/contracts-lock.yaml`; `evidence/SF-M09-CG-001/**`; handover |
| `contracts_lock_mode` | `APPEND_NEW_M09_ROWS_ONLY` (and optional M10) |
| `existing_34_frozen_contracts_mutable` | **false** |
| `ccr_required_if_existing_contract_change` | **true** |

Builders start only after freeze on `origin/main` **and** READY promotion **and** dispatch record. This planning package sets `implementation_authorized: false`.
