# CMP-025 Notification Service

Metadata-driven notification dispatch for every channel and tenant (Eng v1.4 CMP-025, INT-013).
Templates, locales and channels are data; there is no service-, tenant- or official-specific code.

Status: SF-M06-002 builder output. Not CERTIFIED, not G6. Host mount is deferred to SF-M06-005.

## Ownership (schema `sf_notification`, role `sf_cmp025_rw`, ADR-0006)

CMP-025 owns notification templates (immutable published versions), dispatch records and delivery
attempts. It does **not** own recipient addresses, connector bindings or provider credentials:

| Dependency | Port | Owner | Unbound behaviour |
|---|---|---|---|
| Connector binding lookup (INT-013) | `ConnectorBindingPort` | CMP-037 | dispatch refused, `SF-INT-001` |
| Recipient handle -> address | `RecipientDirectoryPort` | CMP-004/005 | delivery retried, then failed |
| REAL / SANDBOX delivery | `HubTransport` (via `HubChannelConnector`) | CMP-037 | `CONNECTOR_NOT_BOUND`, retried |
| Authorization | `AuthorizationPort` | CMP-048 (OPA) | `SF-SYS-004`, request refused |

No code here imports a provider SDK or a network module. The only SIMULATED adapter is an in-memory
SMS/email **sink** (`SimulatedChannelConnector`).

## Flow

1. `POST /v1/notifications` (idempotent): authorize (OPA) -> resolve and re-validate the connector
   binding **outside** any transaction -> one short transaction inserts the `QUEUED` dispatch, the
   outbox event and the audit event. Delivery is asynchronous (`202`).
2. `NotificationDeliveryWorker.deliverDue(ctx)` (per tenant, `SYSTEM` actor): short claim transaction
   (lease, `FOR UPDATE SKIP LOCKED`) -> render, resolve the recipient and call the connector with
   **no transaction open** -> short finalize transaction (attempt row, status, outbox, audit).
   Transient failures retry with deterministic exponential backoff; the last attempt fails the row.
   Delivery is at-least-once; the provider idempotency key is the dispatch id.
3. `POST /v1/notifications/{id}/receipt` (`INTEGRATION` actor): `SENT` -> `DELIVERED` / `UNDELIVERED`.

## INT-013 / SF-CON-SIMULATION-MARKER

- The client never supplies `connector_mode`; it comes from the resolved binding.
- `SIMULATED` is accepted only when the binding environment is `LOCAL|CI|DEVELOPMENT|SIT|PERFORMANCE`,
  equals this runtime's `environment`, carries `simulator_version`, and a `testRunId` is configured.
  Every such dispatch and attempt stores a frozen-schema `SimulationMarker`; the sink prefixes every
  rendered message `[TEST/SIMULATED run=<id>]`.
- A `critical` binding in `PRODUCTION` must be `REAL` (the policy refuses `SIMULATED` and `SANDBOX`).
- `REAL` and `SANDBOX` need a `secret_ref` (a reference only; resolved by CMP-037, never here).
- The same rules are CHECK constraints in `sf_notification.notification_dispatch`.
- Delivery re-validates the binding; drift in mode, environment or tenant fails the dispatch closed
  without sending.

## Privacy

`recipient_handle_ref` is an opaque handle. Template parameter values pass a deterministic PII guard
(e-mail, phone/ID-number, tax-id shapes, control characters, length) and parameter names that look
like PII are refused at template publication. Addresses, rendered bodies, parameters and secret refs
have no permitted logging key (`LOG_FIELD_ALLOWLIST`) and never appear in events, audit or errors.

## Known residuals

- `PUSH` and `IN_APP` channels exist in `SF-CON-NOTIFICATION-DISPATCH` but `SF-CON-CONNECTOR-BINDING`
  has no matching `connector_type`; they fail closed (`CHANNEL_CONNECTOR_UNMAPPED`) until a Contract
  Change Request adds one. This package does not guess a mapping.
- Topic `sf.notification.events.v1` is declared in `contracts/topics.json`; registration in the
  CMP-038 registry is outside this lane's write paths.
- `pnpm-lock.yaml` is untouched; `EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL` (new importer row).

## Commands

```
pnpm --filter @serviceform/cmp-025-notification run typecheck
pnpm --filter @serviceform/cmp-025-notification run test:unit
DATABASE_URL=... pnpm --filter @serviceform/cmp-025-notification run test:integration
```
