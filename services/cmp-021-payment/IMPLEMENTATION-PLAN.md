# CMP-021 Implementation Plan

**Task:** SF-M06-004  
**Branch:** `cursor/m06-payment-gateway-bypass-1149`

## Phase 1: SIMULATED gateway bypass (this PR) ✓

- [x] Domain: uuid, fingerprint, money (bigint), intent/callback views, simulation policy
- [x] Errors: SF-PAY-001, SF-PAY-002, SF-INT-001 matching frozen catalogue
- [x] Ports: FeeQuotePort, ConnectorBindingPort, PaymentGatewayPort, WorkflowSignalPort
- [x] Connectors: SimulatedPspConnector (HMAC test-secret), HubPspConnector (transport stub)
- [x] Repo: PgPaymentRepository + MemoryPaymentRepository (test double)
- [x] Service: createIntent, getIntent, applyCallback (exactly-once, idempotent)
- [x] API handler: POST /v1/payment-intents, GET /v1/payment-intents/:id, POST /v1/payment-callbacks
- [x] Migrations: sf_payment schema + outbox/inbox from SF-CON-OUTBOX template
- [x] Contracts: openapi.json, asyncapi.json, isolation.json, topics.json, event schemas
- [x] Tests: 54/54 unit+contract pass; integration stubs written
- [x] INT-013 fail-closed: CRITICAL_NON_REAL_IN_PRODUCTION, NON_SIMULATED_IN_LOCAL_OR_CI_REFUSED
- [x] assertNoOpenTx enforced on all port calls

## Phase 2: REAL/SANDBOX PSP (SF-M06-005 host mount, deferred)

- [ ] HubPspConnector HTTP wiring (CMP-037 secret_ref resolution)
- [ ] WorkflowSignalPort Temporal wiring
- [ ] pnpm lockfile admission (STITCH-B)
- [ ] PostgreSQL integration tests (DATABASE_URL)
- [ ] REAL webhook crypto (provider-specific, INT-013 REAL)
- [ ] Performance/resilience tests (G6 gate)
