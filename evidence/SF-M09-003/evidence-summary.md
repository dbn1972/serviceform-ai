---
cursor:
  subagentId: "bc-36cdf44b-6480-513b-9a69-812b8af9f210"
module: SF-M09-003
component: CMP-058
title: CMP-058 Semantic Registry Evidence Summary
status: CANDIDATE_COMPLETE
recorded_at: "2026-10-15T15:40:00Z"
---

# CMP-058 Semantic Registry – Evidence Summary

## Module & Component
- **Module**: SF-M09-003 (CG-03 Wave A)
- **Component**: CMP-058 Government Semantic & Data Dictionary Registry
- **Branch**: `cursor/m09-003-semantic-91f2`
- **Base**: `origin/main`
- **Frozen Contract**: `SF-CON-SEMANTIC-ELEMENT` (FROZEN)

## Architecture Compliance
- Semantic elements are GLOBAL isolation class (no tenant payload on element records)
- Field bindings are TENANT_SCOPED with FORCE RLS
- All versions are immutable once PUBLISHED (enforced by DB trigger `semantic_element_immutable_tg`)
- No government policy meanings invented or stored (SF-CON-SEMANTIC-ELEMENT requirement)
- Opaque refs only: `element_id` + `version` are the only cross-system identifiers
- INT-011 (tenant isolation): FORCE RLS on all tenant-scoped tables; OPA authz on all routes
- INT-016 (Semantic Registry → Studio): `GET /v1/elements` and `GET /v1/bindings` expose published elements; Studio binds fields via `POST /v1/bindings`

## Test Results

### Unit + Contract Tests
- **Run**: `pnpm run test:unit` in `services/cmp-058-semantic-registry`
- **Evidence file**: `evidence/SF-M09-003/junit/unit.xml`
- **Result**: 31/31 PASS
- Test files:
  - `test/unit/domain.test.ts` — 9 tests: fingerprint, uuid, idempotency key validation
  - `test/unit/plugin-http.test.ts` — 18 tests: element CRUD, field bindings, security/isolation, invented-policy rejection, idempotency, outbox events
  - `test/contract/contracts.test.ts` — 4 tests: OpenAPI/AsyncAPI parsability, isolation declarations, event envelope/audit validation, SF-CON-SEMANTIC-ELEMENT frozen contract

### Typecheck
- `pnpm run typecheck` in `services/cmp-058-semantic-registry` — PASS (exit 0)

## Security Tests Evidence (unit level)
- Unauthenticated request → 401
- Non-privileged admin creating element → 403
- Privileged admin without MFA creating element → 403
- Binding read without tenant context → 401
- Tenant-identifying headers rejected → 403
- OPA denied action → 403
- Cross-tenant binding isolation verified (T2 cannot see T1 bindings)

## DB Migration
- `db/migrations/1761200000000_cmp-058-semantic-registry.sql` — schema + tables
- `db/migrations/1761200000001_cmp-058-outbox.sql` — outbox/inbox (SF-CON-OUTBOX template)

## Contracts
- `services/cmp-058-semantic-registry/contracts/openapi.json`
- `services/cmp-058-semantic-registry/contracts/asyncapi.json`
- `services/cmp-058-semantic-registry/contracts/isolation.json`
- `services/cmp-058-semantic-registry/contracts/topics.json`

## Not Executed (requires live database / CI)
- Integration tests (no real PostgreSQL in this environment)
- Performance / resilience gates
- Maker-checker gate (G4 not self-certifiable)

## Recommended Gate Status
- **G3**: CANDIDATE — evidence supports G3; human/CI gate required for certification
- **CERTIFIED**: NOT SELF-CERTIFIED — per ADR/Architecture Constitution constraint 28

## Blocking Gates Passed (automated)
- Tenant isolation: all tenant tests pass
- No invented government policy (proven by contract test)
- Published immutability: enforced in DB + verified in unit tests
- OPA authz on all write operations
