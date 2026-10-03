# Contracts

OpenAPI, AsyncAPI, JSON Schema, policy and workflow contracts live here. The Architecture &
Contract Guardian creates them in M00/M01; FROZEN versions are recorded in
`orchestrator/contracts-lock.yaml`.

## `shared/` (M00, status DRAFT)

Cross-component envelopes every builder consumes first (ARCHITECTURE-VERIFICATION-001 §5):

| Schema | Source |
|---|---|
| `schemas/request-context.schema.json` | TI v1.0 s6, AWS v1.7 s13.1 (server-derived tenant/actor context) |
| `schemas/event-envelope.schema.json` | AWS v1.7 s13.2 (snake_case field set; see proposed ADR-0002) |
| `schemas/error-response.schema.json` + `error-catalogue.json` | AWS v1.7 s13.1, s13.3 |
| `schemas/idempotency-record.schema.json` | AWS v1.7 s13.4 |
| `schemas/audit-event.schema.json` | AWS v1.7 s14.3 |
| `schemas/authz-decision.schema.json` | AWS v1.7 s20.3 (OPA input/output) |
| `schemas/connector-binding.schema.json`, `simulation-marker.schema.json` | Eng v1.4 s10 |
| `schemas/isolation-declaration.schema.json` | TI v1.0 s7, Constitution #24 |

`examples/valid` must validate and `examples/invalid` must fail (`pnpm contracts:validate`).
TypeScript types and validators: `packages/contracts`. The `SF-SYS-*` error codes are proposed
additions: AWS v1.7 s13.3 has no code for generic not-found, validation or internal errors.

Builders treat `contracts/**` as read-only (task envelope `read_only_paths`).
