# CG-02 M06 / M08 contract prerequisites (PROPOSED — do not freeze in this PR)

**Status:** `PROPOSED` / `CONTRACT-GUARDIAN-REVIEW-REQUIRED`.  
**This PR does not freeze anything.**  
`CG_02_CONTRACT_FREEZE_REQUIRED=true`.

SF-M06-CG-001 and SF-M08-CG-001 run **after** planning merge and **before** Wave A, and only after a **separate human freeze authorization**. Later CG may freeze **NEW** M06/M08 contracts only.

Existing lock: **19/19 MATCH**. MUST NOT silently modify the current 19 frozen contracts (original 13 shared + six M05). If any of those must change: **CCR + STOP**.

## Consume as-is (FROZEN, do not edit)

| ID | Why M06/M08 need it |
|---|---|
| SF-CON-COMMON | IDs, timestamps, tenant fields |
| SF-CON-REQUEST-CONTEXT | inbound actor/tenant/correlation |
| SF-CON-AUTHZ-DECISION | OPA decision envelope on every command |
| SF-CON-ERROR-RESPONSE / SF-CON-ERROR-CATALOGUE | fail-closed API errors |
| SF-CON-EVENT-ENVELOPE | outbox events (payment callbacks, index jobs, retention) |
| SF-CON-IDEMPOTENCY | payment webhooks, notification sends, index upserts |
| SF-CON-AUDIT-EVENT | fee/payment/notification/retention mutations |
| SF-CON-ISOLATION-DECLARATION | TENANT_SCOPED payment/notification/search/retention tables |
| SF-CON-DB-SESSION-CONTEXT | RLS session, no SUPERUSER |
| SF-CON-OUTBOX | short PG txn + outbox; no I/O in txn |
| SF-CON-CONNECTOR-BINDING | PSP / SMS / email / OpenSearch adapter bindings |
| SF-CON-SIMULATION-MARKER | INT-013; production fail-closed on critical SIMULATED |
| SF-CON-APPLICATION-CASE-SM | M06 payment callback / M08 discovery draft pins into case (consume) |
| SF-CON-WORKFLOW-MODEL | M06 workflow signal after verified payment (consume) |
| SF-CON-COMMAND-TRANSITION | command envelope for case/workflow consumers (consume) |
| SF-CON-HUMAN-TASK | ops dashboard task views (consume) |
| SF-CON-SLA-CLOCK | ops/analytics SLA breach views (consume) |
| SF-CON-VERSION-PINNING | fee/form/service version pins (consume) |

## NEW M06 contracts (identify now; freeze later via SF-M06-CG-001)

Proposed IDs are placeholders for guardian review. Paths under `contracts/m06/**` (not mutating the 19). Do not regenerate SDKs in this PR.

| Proposed ID | Subject | Owning CMP | Required contents (planning) |
|---|---|---|---|
| SF-CON-FEE-QUOTE | Fee quote / breakdown | CMP-020 | Quote id, service/version pins, line items, currency, waiver flags as **metadata refs only** (no invented statute), idempotency key |
| SF-CON-PAYMENT-INTENT | Payment intent | CMP-021 | Amount/currency from fee quote, PSP binding, status machine, tenant isolation |
| SF-CON-PAYMENT-CALLBACK | Verified payment callback | CMP-021 | Signature/verification result, INT-007 linkage to application/workflow, **exactly-once** financial effect |
| SF-CON-NOTIFICATION-DISPATCH | Notification dispatch | CMP-025 | Template ref, channel, locale, recipient handle class (no raw PII in logs), INT-013 mode marker |
| SF-CON-MESSAGE-THREAD | Messaging thread | CMP-026 | Thread/participants/scopes, attachment refs (storage keys), read receipts |

## NEW M08 contracts (identify now; freeze later via SF-M08-CG-001)

| Proposed ID | Subject | Owning CMP | Required contents (planning) |
|---|---|---|---|
| SF-CON-SEARCH-DOCUMENT | Search index document | CMP-035 | Tenant-safe document envelope, facet fields, source CMP refs, no cross-tenant fields |
| SF-CON-DISCOVERY-QUERY | Discovery query/result | CMP-006 | Jurisdiction/service filters, catalogue pins, pagination |
| SF-CON-RECOMMENDATION | Recommendation result | CMP-007 | Non-authoritative advice, reason codes, CMP-039 model/route refs, consent markers |
| SF-CON-ANALYTICS-METRIC | Analytics metric point | CMP-045 | Aggregates only; purpose limitation; no raw PII payloads |
| SF-CON-RETENTION-POLICY | Retention policy binding | CMP-049 | Policy id, scope, **owner-supplied** period refs — `STATUTORY_RETENTION_POLICY_INPUT_REQUIRED` until supplied; archive/delete eligibility transitions |

## Freeze rules for SF-M06-CG-001 / SF-M08-CG-001 (later; not this PR)

`freeze_authorized: false` in this planning package.

| Field | Value |
|---|---|
| `planned_freeze_write_paths` (M06) | `contracts/m06/**`; append-only NEW rows on `orchestrator/contracts-lock.yaml`; `evidence/SF-M06-CG-001/**`; handover |
| `planned_freeze_write_paths` (M08) | `contracts/m08/**`; append-only NEW rows on `orchestrator/contracts-lock.yaml`; `evidence/SF-M08-CG-001/**`; handover |
| `contracts_lock_mode` | `APPEND_NEW_M06_OR_M08_ROWS_ONLY` |
| `existing_19_frozen_contracts_mutable` | **false** |
| `ccr_required_if_existing_contract_change` | **true** |
| `contracts/shared/**` and existing M05 contract files | READ-ONLY |

1. OpenAPI / JSON Schema / events for the NEW IDs (or guardian-approved subset) under `contracts/m06/**` / `contracts/m08/**`.
2. May **append** new rows to `orchestrator/contracts-lock.yaml` for those NEW IDs only. Existing 19 hashes stay byte-identical.
3. MUST NOT edit files of the 19 frozen contracts. MUST NOT weaken event-envelope, outbox, authz-decision, isolation, simulation-marker, or payment idempotency semantics.
4. If fee/payment/search/retention **requires** a change to an existing frozen contract: **do not patch**. File a Contract Change Request and STOP Wave A.
5. Builders start only after freeze is on `origin/main` **and** an orchestrator dispatch record **and** READY promotion authorization. This planning package sets `implementation_authorized: false`.

## Classification of edges

| Edge class | Examples | Action now |
|---|---|---|
| Consume existing FROZEN | request-context, outbox, simulation-marker, M05 case SM | Lock as-is |
| NEW module contract | fee-quote, payment-callback, search-document, retention-policy | Propose; freeze later |
| External adapter | PSP, SMS, email, OpenSearch | SF-CON-CONNECTOR-BINDING + SIMULATION-MARKER; no new infra invention |
| Policy input required | statutory retention periods | `STATUTORY_RETENTION_POLICY_INPUT_REQUIRED`; stop if builder would invent |
| CCR if forced shared change | weakening idempotency / isolation | CCR+STOP |

## Peers that must stay ports (no cross-module implementation)

| Peer | Module | Treatment |
|---|---|---|
| CMP-015/016 case/workflow | M05 | Consume FROZEN case/workflow contracts; no case engine edits |
| CMP-039 AI Gateway | M04 (on main) | Sole model path for CMP-007 |
| CMP-012 DigiLocker | M07 | OFF; SIMULATED only if an INT path demands it via INT-013 |
| CMP-022/023/024 credentials | M07 | OFF |
| OpenSearch / PSP / SMS vendors | external | Adapter ports only; mode discipline INT-013 |

## Explicit non-goals

- No freeze in this PR
- No SDK regeneration
- No `contracts-lock.yaml` edits
- No invented fee schedules, PSP rules, or retention periods
