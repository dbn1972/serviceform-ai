# SF-M07-004 Remediation Evidence

**Branch:** cursor/m07-004-rem-3dc6  
**Base:** origin/main @ dfa96a0 (Merge PR#149 host M07 mounts)  
**Date:** 2026-10-14  
**Agent:** serviceform-integration-builder / claude-sonnet-4-6  
**Authorization:** HUMAN_M07_THROUGH_EVD_AUTHORIZATION=true (remediation)

## Test Summary

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| publish.test.ts (regression) | 12 | 12 | 0 |
| simulation.test.ts (regression) | 12 | 12 | 0 |
| tenant-negative.test.ts (regression) | 5 | 5 | 0 |
| contracts.test.ts (regression) | 11 | 11 | 0 |
| **remediation.test.ts (new)** | **26** | **26** | **0** |
| **Total CMP-012** | **66** | **66** | **0** |
| Workspace regression | 2736 | 2736 | 0 |

JUnit: `evidence/SF-M07-004/junit/rem-unit.xml`

## Findings Closed

### F01 / SEC-F06 — Credential ISSUED verification via CMP-022 port

**Root cause:** `publishCredential` accepted any credential UUID and hardcoded
`credential_lifecycle_status_at_request: 'ISSUED'` without ever checking CMP-022.

**Fix:**
- New port: `src/ports/credential-verification-port.ts` — `CredentialVerificationPort` +
  `assertCredentialIssuedForPublish` guard function + `UnboundCredentialVerificationPort` stub.
- `DigiLockerServiceDeps.credentialVerification` added (required; defaults to unbound in `index.ts`).
- `publishCredential` calls the port before binding resolution; `assertCredentialIssuedForPublish`
  enforces: found, tenantId matches, signed, lifecycle === 'ISSUED'. All failures are fail-closed
  (no silent fallback, no retries with degraded state).
- Port failure (non-Cmp012Error) maps to `SF-SYS-004` (503).

**Tests:** 7 new cases in `remediation.test.ts` covering: ISSUED pass, not-found→404,
wrong-tenant→403, unsigned→400, DRAFT→400, REVOKED→400, port-error→503.

### F05 — Forged tenant header defence

**Root cause:** `assertNoTenantIdentifyingHeaders` only checked 3 hardcoded exact names.
Peer pattern (SF-TEN-002) requires prefix matching for `x-tenant-*`, `x-sf-*`, and
`Forwarded tenant=` RFC 7239 token.

**Fix:** `src/context.ts` replaced exact-name list with:
- Exact names: `x-real-tenant-id`, `x-bypass-rls`, `x-override-tenant` (preserved)
- Prefix patterns: `x-tenant-*`, `x-sf-*`, `x-forwarded-tenant` (added)
- Structured: `Forwarded` header with `tenant\s*=` token match (RFC 7239)

**Tests:** 14 new unit cases (13 should-refuse + 1 should-pass legitimate headers)
plus 3 API handler integration cases.

### F06 — Injected SIMULATED adapter in PRODUCTION (mode/binding cross-check)

**Root cause:** `assertBindingPolicy` validates the binding record but not the actual adapter
instance. An injected `SimulatedDigiLockerConnector` (mode=SIMULATED) would proceed even when
binding.mode=REAL.

**Fix:** `service.ts` asserts `this.deps.digilockerApi.mode === binding.mode` immediately
after `assertBindingPolicy`. On mismatch → `Cmp012Error('SF-INT-001', detail('ADAPTER_MODE_MISMATCH'))`.
This subsumes the PRODUCTION+critical+SIMULATED case since if binding.mode=REAL and adapter.mode=SIMULATED
they will never match.

**Tests:** 3 new cases: PRODUCTION REAL binding + SIMULATED adapter → throws Cmp012Error;
assertBindingPolicy still rejects critical SIMULATED binding in PRODUCTION; SANDBOX vs SIMULATED
mismatch → SF-INT-001.

## NOT certified
- CERTIFIED: false
- g3: false
- g6: false
- Self-certified: false
