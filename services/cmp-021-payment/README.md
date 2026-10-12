# CMP-021 Payment Service

**Task:** SF-M06-004  
**Status:** CANDIDATE_COMPLETE — SIMULATED/bypass gateway only  
**Not certified. Not G3. Not production-ready for REAL PSP.**

## Overview

Implements SF-M06-004 Payment Service with:
- Payment intent creation (amount locked from CMP-020 fee quote)
- PSP callback verification with exactly-once financial effect
- SIMULATED PSP adapter (no network) for LOCAL/CI
- INT-013 fail-closed binding policy
- Idempotent create + replay
- Post-commit workflow signal (INT-007, no-op default)

## Architecture

```
Citizen/API
│
▼
PaymentService (CMP-021) ──OPA──► AuthorizationPort (CMP-048)
│
├─(outside TX)──► FeeQuotePort ──────────► CMP-020 (locked amount/currency)
├─(outside TX)──► ConnectorBindingPort ──► CMP-037 binding (mode + secret_ref)
├─(outside TX)──► PaymentGatewayPort ────► SIMULATED | HubPSP (REAL/SANDBOX later)
│
└─(short TX)────► sf_payment.* + outbox
                         │
                   └─(post-commit)──► WorkflowSignalPort ──► CMP-016 (INT-007)
```

## Domain Rules

- **Amount**: never client-supplied; always copied from fee quote via `FeeQuotePort`
- **Exactly-once financial effect**: `exactly_once_key` unique constraint in `sf_payment.exactly_once_effect`
- **Signature verification**: must be `signature_verified=true` before any financial effect
- **INT-013**: SIMULATED refused in PRODUCTION for critical bindings; LOCAL/CI must be SIMULATED

## Running Tests

```bash
pnpm --filter @serviceform/cmp-021-payment run typecheck
pnpm --filter @serviceform/cmp-021-payment run test:unit
pnpm --filter @serviceform/cmp-021-payment run test:integration  # requires DATABASE_URL
```

## Deferred

- REAL/SANDBOX PSP SDK integration (SF-M06-005 host mount)
- Temporal workflow signal wiring (SF-M06-005 host mount)
- PostgreSQL integration tests (need `DATABASE_URL`)
- Production gateway webhook crypto (INT-013 REAL adapter via CMP-037)
