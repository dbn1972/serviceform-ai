# SF-M06-004 Evidence — CMP-021 Payment Service (SIMULATED gateway bypass)

**Task:** SF-M06-004  
**Component:** CMP-021 Payment Service  
**Branch:** `cursor/m06-payment-gateway-bypass-1149`  
**Base commit:** `eeeece461325ed2ca896d404e393d07632dc5ec5`  
**Builder model:** claude-sonnet-4-6  
**Date:** 2026-10-12  

## Non-claims

| Claim | Value |
|---|---|
| CERTIFIED | **false** |
| G3_INTEGRATION_VERIFIED (M06) | **false** |
| G6 / RELEASE_CERTIFIED | **false** |
| self_certified | **false** |
| Production REAL gateway ready | **false** |

---

## Test Evidence

### Typecheck
```
pnpm --filter @serviceform/cmp-021-payment run typecheck
PASS (exit 0)
```

### Unit + Contract Tests
```
pnpm --filter @serviceform/cmp-021-payment run test:unit
Test Files: 7 passed (7)
Tests:      55 passed (55)
```

JUnit output: `evidence/SF-M06-004/junit/unit.xml`

**Changes since prior run:**
- `service.test.ts` now includes `priorResult replay` test (verifies no second fee quote call on idempotency replay)
- `service.test.ts` rewrote `rejects client-supplied amount` to call `validateCreateIntentInput` directly with 4 amount field variants; confirms code `SF-SYS-003` (status 400, not 409)
- `api-flow.test.ts` updated expected status from 409 to 400 for client-supplied amount route
- Total: 54 → 55 tests (+1 priorResult replay)

### Integration Tests (PostgreSQL 16.15, DATABASE_URL set)
```
pnpm --filter @serviceform/cmp-021-payment run test:integration
Test Files: 2 passed (2)
Tests:      14 passed | 1 skipped (15)
```

JUnit output: `evidence/SF-M06-004/junit/integration.xml`

- `api-flow.int.test.ts` — 4 PASS: create+persist+replay, callback CAPTURED+duplicate exactly_once (zero second effect), cross-tenant 404, refused writes nothing
- `privilege-rls.int.test.ts` — 10 PASS / 1 skipped: ADR-0006 role attributes, FORCE RLS, ownership, grants, tenant isolation, peer denial, canary invisibility

---

## Frozen Contract Hashes Verified

| Contract | Expected hash | Verified |
|---|---|---|
| SF-CON-PAYMENT-INTENT | `776d1f6e...` | ✓ by `contracts.test.ts` |
| SF-CON-PAYMENT-CALLBACK | `ca0bacba...` | ✓ by `contracts.test.ts` |

Both frozen schemas are unchanged (test confirms hash match vs `orchestrator/contracts-lock.yaml`).

---

## Domain Rules Verified

| Rule | Test |
|---|---|
| Amount locked from fee quote (client cannot supply amount; SF-SYS-003) | `service.test.ts > rejects client-supplied amount` |
| Exactly-once financial effect (SF-PAY-002) | `service.test.ts > duplicate callback returns prior result` |
| Signature verified required for financial effect | `service.test.ts > REJECTED callback: no financial effect` |
| Idempotency priorResult short-circuits port calls on replay | `service.test.ts > priorResult replay` |
| Port calls outside TX (`assertNoOpenTx`) | `service.test.ts > port calls are outside TX` |
| Cross-tenant fee quote denied | `service.test.ts > cross-tenant fee quote is denied` |
| INT-013 fail-closed (CRITICAL_NON_REAL_IN_PRODUCTION) | `privilege-isolation.test.ts` |
| INT-013 fail-closed (unbound port) | `service.test.ts > INT-013 fail-closed` |

---

## Frozen Schema View Conformance

| Output | Schema | Result |
|---|---|---|
| `intentView(row)` | SF-CON-PAYMENT-INTENT | ✓ validates |
| `callbackView(row)` | SF-CON-PAYMENT-CALLBACK | ✓ validates |

---

## Architecture Compliance

- No cross-component SQL (confirmed: no `sf_fee.*` or peer schemas in `sf_payment.*` code)
- No network I/O inside DB transactions (assertNoOpenTx enforced in service layer)
- FORCE RLS on all TENANT_SCOPED tables (confirmed by `isolation.json` + migration test)
- No `BYPASSRLS` in migration (confirmed by contract test)
- No invented PSP fee statute or named PSP policy
- No PII stored in payment tables (only handle refs and connector binding IDs)

---

## Residuals (STITCH-B)

1. `pnpm-lock.yaml` admission: `@serviceform/cmp-021-payment` package must be added
2. `HubPspConnector` wiring: host mount (SF-M06-005) required before REAL/SANDBOX PSP
3. `WorkflowSignalPort` Temporal wiring: host mount (SF-M06-005) for INT-007
4. Integration tests with PostgreSQL: need `DATABASE_URL`; real tests implemented (not just stubs)
5. REAL PSP webhook crypto: deferred to INT-013 REAL adapter via CMP-037
