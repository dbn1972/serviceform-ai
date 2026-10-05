# M05 contract prerequisites (PROPOSED — do not freeze in this PR)

**Status:** `PROPOSED` / `CONTRACT-GUARDIAN-REVIEW-REQUIRED`.  
**This PR does not freeze anything.** SF-M05-CG-001 runs **after** planning merge and **before** Wave A. Later CG may freeze **NEW** M05 contracts only.

Existing shared lock: **13/13 MATCH**. MUST NOT silently modify the current 13 frozen shared contracts (`contracts/shared/**` hashes in `orchestrator/contracts-lock.yaml`). If any of those must change: **CCR + STOP**.

## Consume as-is (FROZEN, do not edit)

| ID | Why M05 needs it |
|---|---|
| SF-CON-COMMON | IDs, timestamps, tenant fields |
| SF-CON-REQUEST-CONTEXT | inbound actor/tenant/correlation |
| SF-CON-AUTHZ-DECISION | OPA decision envelope on every command |
| SF-CON-ERROR-RESPONSE / SF-CON-ERROR-CATALOGUE | fail-closed API errors |
| SF-CON-EVENT-ENVELOPE | outbox events after CMP-015 commit |
| SF-CON-IDEMPOTENCY | commands, Temporal signals, callbacks |
| SF-CON-AUDIT-EVENT | case/task/SLA mutations |
| SF-CON-ISOLATION-DECLARATION | TENANT_SCOPED case/task/SLA tables |
| SF-CON-DB-SESSION-CONTEXT | RLS session, no SUPERUSER |
| SF-CON-OUTBOX | short PG txn + outbox; no I/O in txn |
| SF-CON-CONNECTOR-BINDING | INT-006 SIMULATED DigiLocker / S3 ports |
| SF-CON-SIMULATION-MARKER | INT-013; production fail-closed on critical SIMULATED |

## NEW M05 contracts (identify now; freeze later via SF-M05-CG-001)

Proposed IDs are placeholders for guardian review. Paths under `contracts/m05/**` (not `contracts/shared/` of the 13). Do not regenerate SDKs in this PR.

| Proposed ID | Subject | Owning CMP | Required contents (planning) |
|---|---|---|---|
| SF-CON-APPLICATION-CASE-SM | Application / case state machine | CMP-015 | States, legal transitions, command names, who may fire (OPA resource), idempotency key, **authoritative store = CMP-015** |
| SF-CON-WORKFLOW-MODEL | Canonical workflow model / DSL | CMP-016 | Steps, waits, timers, rule-result branches, BPMN import/export **profile only**, published-version immutability, no named officer |
| SF-CON-COMMAND-TRANSITION | Command / transition envelope | CMP-015 (+016 consumer) | Command type, case id, expected pins, OPA decision ref, Temporal signal **after** domain commit |
| SF-CON-HUMAN-TASK | Human Task | CMP-017 | Create/claim/unclaim/reassign/complete; assignment = role+org+jurisdiction+scope |
| SF-CON-SLA-CLOCK | SLA clock pause/resume | CMP-029 | Start/completion anchors, business calendar, pause/resume (INT-009), breach/escalation metadata |
| SF-CON-VERSION-PINNING | Application pin graph | CMP-015 (+052 consume) | application ↔ TenantServiceBinding ↔ workflow ↔ rule/form/evidence exact published versions |

## Freeze rules for SF-M05-CG-001 (later; not this PR)

`freeze_authorized: false` in this planning package. Future legal write scope is machine-readable on the CG-001 envelopes (`planned_freeze_write_paths` + `planned_freeze_constraints`); this PR does not write those paths.

| Field | Value |
|---|---|
| `planned_freeze_write_paths` | `contracts/m05/**`; `orchestrator/contracts-lock.yaml`; `evidence/SF-M05-CG-001/**`; `orchestrator/handovers/SF-M05-CG-001.yaml` |
| `contracts_lock_mode` | `APPEND_NEW_M05_ROWS_ONLY` |
| `existing_13_frozen_contracts_mutable` | **false** |
| `ccr_required_if_existing_contract_change` | **true** |
| `contracts/shared/**` | READ-ONLY |

1. OpenAPI / JSON Schema / events for the six NEW IDs (or guardian-approved subset) under `contracts/m05/**`.
2. May **append** new rows to `orchestrator/contracts-lock.yaml` for those NEW IDs only. Existing 13 hashes stay byte-identical.
3. MUST NOT edit files of the 13 frozen shared contracts. MUST NOT weaken compatibility of event-envelope, outbox, authz-decision, isolation, simulation-marker.
4. If CMP-015 SM, command envelope, or pinning **requires** a change to an existing frozen shared contract: **do not patch**. File a Contract Change Request and STOP Wave A.
5. Builders start only after freeze is on `origin/main` **and** an orchestrator dispatch record. This planning package sets `implementation_authorized: false`.

## Peers that must stay ports (no M05 implementation)

| Peer | Module | M05 treatment |
|---|---|---|
| CMP-021 Payment | M06 | Port / SIMULATED callback only; no fee/payment service |
| CMP-025 Notification | M06 | Port only; no SMS/email templates or providers |
| CMP-012 DigiLocker | M07 | INT-006 via INT-013 SIMULATED; no DigiLocker connector |
| CMP-020 Fee | M06 | Do not pull; fee after durable application is M06 |
| CMP-026 Messaging | M06 | Do not pull |

INT-006 in M05 verifies Evidence → storage/OCR → verification using **existing** M04 components on `main` plus SIMULATED DigiLocker. It does not implement CMP-012.
