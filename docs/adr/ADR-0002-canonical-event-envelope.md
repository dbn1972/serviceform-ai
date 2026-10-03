# ADR-0002: Canonical wire envelopes use the AWS v1.7 snake_case field set

| Field | Value |
|---|---|
| Status | **PROPOSED** (Architecture & Contract Guardian review and human approval required before the shared contracts are FROZEN) |
| Date | 3 October 2026 |
| Proposed by | Claude (M00 bootstrap), from ARCHITECTURE-VERIFICATION-001 finding M-01 |
| Changes | Contract field naming only. No component boundary, gate or constitution rule changes. |
| Artifacts | `contracts/shared/schemas/*.schema.json` (status DRAFT in `orchestrator/contracts-lock.yaml`) |

## Context

AWS v1.7 §13.2 defines the event envelope with snake_case fields (`event_id`, `schema_version`,
`tenant_id`, `cell_id`, `aggregate_version`, `occurred_at`, `correlation_id`, `causation_id`,
`actor`, `data`). Engineering v1.4 Appendix A and Tenant Isolation v1.0 §13 describe the same
fields in camelCase (`eventId`, `eventVersion`, `tenantId`, `cellId`, `payload`). AWS v1.7 also
uses snake_case for the error body (`correlation_id`), the audit minimum contract (§14.3) and the
OPA decision contract (§20.3). The event envelope is the first contract every builder consumes,
so two spellings would split producers and consumers.

## Decision (proposed)

1. All shared wire contracts (event envelope, error response, request context, idempotency
   record, audit event, OPA input/output, connector binding, simulation marker) use the AWS v1.7
   snake_case field names. AWS v1.7 has higher precedence than Engineering v1.4 and TI v1.0.
2. Engineering v1.4 Appendix A and TI v1.0 §13 are read as describing the same fields:
   `eventVersion` = `schema_version`, `payload` = `data`.
3. TypeScript code may use the snake_case types from `packages/contracts` directly; no
   camelCase mapping layer is introduced.
4. Generic platform errors get a new `SF-SYS-*` family (`SF-SYS-001` internal, `-002` not found,
   `-003` request validation, `-004` unavailable), because AWS v1.7 §13.3 has no code for them.

## Consequences

- `contracts/shared/examples/invalid/event-envelope.camel-case.json` documents that camelCase
  envelopes are rejected.
- On acceptance the Contract Guardian sets the shared contracts to FROZEN in
  `orchestrator/contracts-lock.yaml`; `scripts/gates/contracts_lock_gate.py` then fails any
  unreviewed change.
