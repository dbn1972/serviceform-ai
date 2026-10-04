# CMP-039 AI Gateway

Single governed entry for every model/provider call (AI-GOVERNANCE.md). Domain components never call a
model provider directly; they call this gateway through its contract.

## Eng v1.4 interfaces

- `POST /v1/ai/invoke`
- `POST /v1/ai/embed`
- `GET /v1/ai/models/capabilities`
- Registry administration (component-local): `POST /v1/ai/admin/models`,
  `POST /v1/ai/admin/models/{id}/revoke`, `POST /v1/ai/admin/policies`,
  `POST /v1/ai/admin/policies/{policyId}/versions/{version}/retire`

Events (`sf.aigateway.events.v1`): `AIRequestCompleted`, `AIRequestBlocked`, `AIProviderFallbackUsed`,
plus `AuditEventSubmitted` on `sf.audit.ingest.v1`.

## Controls implemented

| Control | Where |
|---|---|
| Provider/model allowlist + version pinning (no floating tags) | `model_registry`, `service/registry.ts`, `service/gateway.ts` |
| Immutable prompt/policy versions with pinned evaluation reference | `ai_policy`, DB trigger |
| Tool allowlist with scopes, least-privilege effects (`READ_ONLY`, `DRAFT_ONLY`) | policy `allowed_tools`, `gateway.ts` |
| Data classification ceiling per policy and model | `domain/classification.ts` |
| Redaction of PII/credentials in prompts, outputs and templates | `domain/redaction.ts` |
| Purpose/consent check for personal data; tenant/source ACL for retrieval | `ports/policy-ports.ts` (default deny) |
| Rate limit, per-request size/output caps, daily token budget per model pin | plugin rate limit, `gateway.ts` |
| Bounded latency, provider failover, fail-safe to non-AI path | `service/provider-call.ts` |
| Audit of policy/prompt hash, model pin, tool and citation metadata (never raw prompt/output) | `ai_request_metadata` (append-only), outbox |
| Decision boundary: only advisory task kinds; responses `advisory_only=true`, `statutory_decision=false` | `domain/statutory-guard.ts`, DB CHECKs |
| SIMULATED provider adapters (INT-013); PRODUCTION + SIMULATED, REAL/SANDBOX fail closed | `config.ts`, `ports/provider.ts` |

## Non-goals (this task)

- API host mount (SF-M04-007), CMP-014 and other consumers
- Real provider adapters (no REAL/SANDBOX mode is accepted)
- Response caching, maker-checker on registry changes
- CERTIFIED / G6 claim
