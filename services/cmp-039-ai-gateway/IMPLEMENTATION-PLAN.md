# SF-M04-001 CMP-039 AI Gateway: implementation plan

Status: **DEVELOP complete (builder)**. **Not VERIFIED. Not CERTIFIED. Not G6.** M05 OFF.

| Field | Value |
|---|---|
| Task | SF-M04-001 |
| Component | CMP-039 |
| Integrations | INT-011 (tenant isolation chain), INT-013 (SIMULATED provider, fail-closed in production) |
| Privilege role | `sf_cmp039_rw` NOLOGIN (ADR-0006 Option A) |
| Schema | `sf_ai_gateway` (all tables TENANT_SCOPED + FORCE RLS; platform outbox/inbox PLATFORM_OPERATIONAL) |

## Impact plan

- Domain: provider abstraction, routing with ordered failover, redaction, safety/decision-boundary guard, quota/budget, audit. No named service, tenant or jurisdiction logic.
- Data: `model_registry`, `ai_policy` (immutable versions), `ai_request_metadata` (append-only, metadata only), idempotency, SF-CON-OUTBOX tables.
- APIs/events: OpenAPI + AsyncAPI under `contracts/`. Shared frozen contracts consumed, not changed.
- Tenancy/authz: tenant from server-derived context only; OPA decision per action; RLS on every tenant table; runtime role is not owner, not superuser, not BYPASSRLS.
- Transactions: no network I/O inside DB transactions. Authz/consent/source-ACL before tx 1; provider call between tx 1 and tx 2.
- Migration: `1759530039000_cmp-039-ai-gateway.sql`, `1759530039001_cmp-039-outbox.sql` (template verbatim). Down drops schema objects, retains role.
- Observability: request metadata carries correlation/trace ids, latency, attempts, tokens, fallback flag.
- Rollback: migrations reversible (down tested by `pnpm db:test`); component has no host mount until SF-M04-007.
