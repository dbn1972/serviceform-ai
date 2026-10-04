# SF-M01-W2-002 implementation plan — CMP-030 Consent & Privacy

Status: **IMPLEMENTATION_READY** for independent Verify. **Not VERIFIED. Not CERTIFIED.**

| Field | Value |
|---|---|
| Task | SF-M01-W2-002 |
| Component | CMP-030 |
| Integration | INT-011 |
| Builder | serviceform-foundation-builder (this agent) |
| Branch | `cursor/m01-w2-cmp-030-4362` |
| Base | `origin/main` @ `f397e13` |
| Schema | `sf_consent_privacy` |
| Privilege role | `sf_cmp030_rw` NOLOGIN (ADR-0006 Option A) |
| Self-certification | **Not claimed.** |

## Impact

- Domain: purpose metadata, versioned privacy notices (content refs only), consent grant/withdraw with assisted `applied_by`/`applied_for`, access-check gate.
- Data: tenant-scoped tables + FORCE RLS; outbox from frozen SF-CON-OUTBOX template.
- APIs: Eng paths under `/v1` plus purpose/notice support routes (component-local OpenAPI).
- Events: ConsentGranted, ConsentWithdrawn, PrivacyNoticeUpdated + AuditEventSubmitted.
- Host mount deferred to SF-M01-W2-004.
- No DPDP/statutory content; stop for ADR if statute required.

## Migrations

1. `1759500700000_cmp-030-consent-privacy.sql`
2. `1759500700001_cmp-030-outbox.sql` (template substitution only)

## Acceptance (builder evidence)

- Deny access-check when purpose requires consent but missing
- Withdrawal auditable + idempotent under repeated Idempotency-Key
- Wrong-tenant / unauthorized zero leakage
- ADR-0006 privilege-boundary + FORCE RLS
- Outbox template unchanged; audit on grant/withdraw/notice publish
