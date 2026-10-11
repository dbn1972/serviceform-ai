# CMP-007 Recommendation Engine

NON_AUTHORITATIVE decision support (Eng v1.4 CMP-007, SF-CON-RECOMMENDATION, INT-003). Suggests
which published catalogue services may be relevant to a citizen, with coded reason codes.

**All model calls go through CMP-039 (AI Gateway) via `AiGatewayPort`.** This service never calls a
provider SDK or model host. A recommendation is never a statutory eligibility, approval, rejection,
penalty, fee waiver, payment or case-state decision. Deterministic rules (CMP-008), officers and the
case/payment components stay authoritative.

## Interfaces (component-local contract)

- `POST /v1/recommendation-policies` (Idempotency-Key) - insert-only, versioned policy: consent purpose
  code, CMP-039 policy id/version, `model_route_ref`, pinned allowed reason/signal code lists, limits
- `POST /v1/recommendations` (Idempotency-Key) - consent check (CMP-030), tenant-safe candidates
  (CMP-001), coded signals (CMP-005), CMP-039 invoke, strict output parse, persisted result
- `GET /v1/recommendations/{id}` - owner (or authorised officer) view embedding SF-CON-RECOMMENDATION
- `POST /v1/recommendations/{id}/disposition` - the citizen `SELECT`s a recommended service or `DISMISS`es;
  emits an event for the INT-003 draft consumer. It never creates or changes an application itself.

Events (`sf.recommendation.events.v1`): `RecommendationRequested`, `RecommendationGenerated`,
`RecommendationFailed`, `RecommendationSelected`, `RecommendationDismissed`, plus
`AuditEventSubmitted` on `sf.audit.ingest.v1`.

## Controls implemented

| Control | Where |
|---|---|
| Models only via CMP-039; no provider SDK/host in source (static test) | `ports/gateway-port.ts`, `contract/contracts.test.ts` |
| Non-authoritative markers on rows, API, events (DB CHECKs + trigger) | migration, `service/recommendation-service.ts` |
| Closed output shape: coded reasons only, no free text, unknown keys refused | `domain/parse-output.ts` |
| Reason/signal/purpose codes naming a binding outcome refused at policy creation | `domain/guard.ts` |
| Candidates aliased (`c1..cn`); the model cannot invent a service | `service/recommendation-service.ts` |
| Consent/purpose (CMP-030) checked before any catalogue/profile/model work; fail closed | service |
| Data minimisation: only coded signals + catalogue codes leave the service; classification PERSONAL | service |
| Fail-safe: gateway denied/unavailable/timeout/unsafe -> `FAILED` + `fallback=NON_AI_DISCOVERY` | service |
| No network inside a DB transaction (`external()` guard + AsyncLocalStorage) | service, `repo/pg.ts` |
| Tenant from server context only; tenant headers refused; FORCE RLS; ADR-0006 `sf_cmp007_rw` | `context.ts`, migration |
| OPA PEP on every route; owner-only read/dispose for citizens | `authz.ts`, service |
| Outbox (SF-CON-OUTBOX byte-for-byte template) + audit in the same transaction | `outbox.ts`, `audit.ts` |
| No raw prompt/output text stored or logged; prompt hash + model pin only | migration, service |

## Ports (no cross-component SQL)

`AiGatewayPort` (CMP-039), `CataloguePort` (CMP-001), `ConsentPort` (CMP-030),
`ProfileSignalPort` (CMP-005), `AuthorizationPort` (OPA PEP).

## Non-goals (this task)

- API host mount (`apps/api`) - deferred to SF-M08-007
- Real adapters for the ports above (wired by the host / later tasks)
- Discovery UX/search (SF-M08-006), analytics (SF-M08-003)
- CERTIFIED / G3 / G6 claim
