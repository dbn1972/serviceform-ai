# CMP-045 Analytics & MIS

Tenant-scoped, purpose-bound **aggregate projections** derived from domain events
(Eng v1.4 CMP-045, INT-010 / INT-011, FROZEN `SF-CON-ANALYTICS-METRIC`).

Status: SF-M08-003 builder output. Not CERTIFIED, not G3, not G6.

## What it is not

CMP-045 is a derived store. It is **not** an authoritative case, application or payment store, it
mutates no other component's state, it stores no raw event payload and no person-level value, and
the database can be rebuilt from the event history at any time (INT-010).

## What it owns (schema `sf_analytics`, role `sf_cmp045_rw`, ADR-0006)

| Table | Behaviour |
|---|---|
| `metric_definition` | Published, versioned metric definitions (event type, aggregation `COUNT`/`SUM`, UTC period, category dimensions, one declared purpose, minimum cohort size). Content is immutable; only `PUBLISHED -> RETIRED`. |
| `projection_state` | Active and building generation per definition, with a build lease and token. |
| `metric_point` | Aggregate points: value, contributor count, category dimensions, period. No payload, subject or actor column. |
| `projection_applied_event` | Event ids only, the dedupe key per generation. |
| `idempotency_record`, `outbox_event`, `inbox_event` (+ `_platform`) | SF-CON-IDEMPOTENCY / SF-CON-OUTBOX template. |

All tenant tables use `FORCE ROW LEVEL SECURITY` with `sf_platform.current_tenant_id()`. The runtime
login inherits only `sf_app` and `sf_cmp045_rw`; it is not the table owner and has no privilege on
any other component's schema.

## Rules enforced

- **Aggregates only.** An event contributes `+1` (COUNT) or the declared numeric field (SUM) to one
  point chosen by period and dimensions. The event itself is discarded.
- **No raw PII.** A dimension value must be an upper-case category code (`^[A-Z0-9][A-Z0-9_.-]{0,63}$`)
  with no 6-digit run and no UUID shape, and must be in the definition's closed vocabulary when one
  is declared. Anything else is stored as `UNCLASSIFIED`, never as the value. Definitions may not name
  a personal or per-record identifier field (`name`, `email`, `mobile`, `aadhaar`, `id`, `ref`, ...).
  The database trigger `guard_metric_point` repeats the value rules, so a bypassing caller is refused
  with `23514`.
- **Purpose limitation.** One `purpose_code` per definition. A read declares its purpose (server
  context wins over `purpose_code`); a mismatch is `SF-AUTH-002` with `PURPOSE_NOT_PERMITTED`, audited.
  A point can only be inserted with its definition's metric code and purpose.
- **Small-cohort suppression.** Cells whose contributor count is below the definition's
  `min_cohort_size` are withheld; the response reports only how many. The threshold is published
  policy data, not a code default.
- **Tenant isolation.** Consumer tenant comes from the validated event envelope, API tenant from the
  server-derived context; header-asserted tenants are refused. OPA PEP first, FORCE RLS always.
- **Idempotent, duplicate-safe.** Duplicate delivery of an event is a no-op (inbox claim in the same
  transaction as the aggregate change; per-generation applied-event ids).
- **Explicit failure.** `schema_version` other than the definition's pin, a non-numeric SUM field, a
  future event time (beyond the configured skew) and a tenant-less event are refused, not guessed.
- **Rebuildable.** `POST .../rebuild` replays the history (`EventReplayPort`, bound to CMP-038 by the
  host) into a new generation outside any transaction, in short batch transactions, then swaps the
  generation atomically. Live events apply to both generations while a build runs. A second rebuild
  is refused while the lease is held; a failed rebuild never replaces the active generation.
- **No network in a DB transaction.** Authorization and replay reads happen before/between
  transactions; `NETWORK_IN_TX` guards the service.

## Interfaces

HTTP routes are framework-neutral (`createAnalyticsApi(...).handle(request)`);
`contracts/openapi.json` documents them: `POST|GET /v1/analytics/metric-definitions`,
`GET /v1/analytics/metric-definitions/{id}`, `POST .../retire`, `POST .../rebuild`,
`GET /v1/analytics/metrics`.

Events (`contracts/asyncapi.json`, topic `sf.analytics.events.v1`): `AnalyticsMetricDefinitionPublished`,
`AnalyticsMetricDefinitionRetired`, `AnalyticsProjectionRebuilt`. They carry identifiers and codes
only, never metric or dimension values.

Ports: `AuthorizationPort` (OPA PEP, fail closed), `ContextResolver` (server-derived context),
`EventReplayPort` (`UnboundReplayPort` is the default until the host binds CMP-038).

## Non-goals

- Host mount on `apps/api` and the CMP-038 subscription wiring (SF-M08-007).
- Retention and archival (CMP-049, SF-M08-005; `STATUTORY_RETENTION_POLICY_INPUT_REQUIRED`). No
  retention period is defined or assumed here and no metric point is deleted except a superseded
  rebuild generation.
- Export jobs, BI/lake storage and tenant-local reporting calendars (periods are UTC).
- Jurisdiction row filtering beyond the OPA resource attributes.

## Known residual risks (recorded, not hidden)

- Suppression is per cell. Overlapping filters across separate queries can still support
  differencing; a rollup/complementary-suppression policy needs an owner decision.
- A rebuild whose later phase fails leaves its idempotency key `IN_PROGRESS`; retry with a new key
  after the build lease expires (default 15 minutes).
- A definition published after events were consumed projects only new events until a rebuild runs.

## Tests

- `pnpm exec vitest run --root services/cmp-045-analytics-mis --config vitest.unit.config.ts`: domain,
  API/service behaviour and contract conformance against the FROZEN schemas.
- `DATABASE_URL=... ... vitest.integration.config.ts`: PostgreSQL privilege boundary, FORCE RLS, DB
  guards, concurrent ingest, rebuild and swap on a real login role.
