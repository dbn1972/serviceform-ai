# SF-M04-002 CMP-008 Eligibility / Rules Engine - implementation plan

Status: **IMPLEMENTATION_READY** (builder recommendation). **Not VERIFIED. Not CERTIFIED. Not G6. M05 OFF.**

| Field              | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| Task               | SF-M04-002                                                             |
| Component          | CMP-008                                                                |
| Integrations       | INT-011 (tenant isolation chain; re-verified later by independent INT) |
| Privilege role     | `sf_cmp008_rw` NOLOGIN (ADR-0006 Option A)                             |
| Schema             | `sf_rules`                                                             |
| Self-certification | **false**                                                              |

## Impact

- Domain: evaluate a tenant-pinned published RULES pack deterministically; record the evaluation.
- Data: `sf_rules` TENANT_SCOPED FORCE RLS; append-only snapshot and evaluation tables (trigger); no cross-schema SQL.
- Ports: `RulePackPort` (published metadata), `AuthorizationPort` (OPA), `RuleEngine` (ZEN).
- Events: `RuleEvaluated` on `sf.rules.events.v1` and audit outbox (`DECISION` class).
- Migration: `1759530200000_cmp-008-rules.sql`, `1759530200001_cmp-008-outbox.sql` (frozen outbox template). Down drops schema objects; role retained.
- Rollback: down migration; component is not mounted until SF-M04-007.
- Dependency note: adds `@gorules/zen-engine@2.0.2` (older than the 7-day release-age policy). `pnpm-lock.yaml` is not committed by builders; STITCH-A admits the importer.

## Acceptance (builder evidence; not CERTIFIED)

1. Deterministic rule evaluation from pinned published metadata only
2. Unauthorized / wrong-tenant denied; CROSS_TENANT_LEAKAGE=0
3. No LLM path; no eligibility rules in OPA; no named-service branching
4. Host mount deferred to SF-M04-007
