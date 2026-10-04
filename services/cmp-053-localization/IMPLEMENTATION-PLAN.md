# SF-M03-005 implementation plan — CMP-053 Localization Service

Status: **IMPLEMENTATION_READY** (builder recommendation). **Not VERIFIED. Not CERTIFIED.**

| Field | Value |
|---|---|
| Task | SF-M03-005 |
| Component | CMP-053 |
| Integrations | INT-002 (catalog publish event), INT-011, INT-013 SIMULATED/fail-closed |
| Builder | serviceform-studio-builder |
| Schema | `sf_localization` |
| Privilege role | `sf_cmp053_rw` NOLOGIN (ADR-0006 Option A) |
| Self-certification | **false** |

## Impact

- Domain: tenant locales with fallback chain; versioned message catalogs; format profiles; resolve fail-closed on missing keys
- Data: `sf_localization` only; no cross-schema SQL; no client tenant headers
- APIs: locales, catalogs, draft messages, publish/retire, resolve, format resolve, optional assist
- Events: `LocalizationCatalogPublished`, `LocalizationCatalogRetired` (+ audit outbox)
- Host mount: deferred to SF-M03-008
- Assist: never authoritative; never mutates published versions; PRODUCTION+SIMULATED refused

## Acceptance (builder-executed)

- TENANT_SCOPED ENABLE+FORCE RLS; privilege-boundary tests
- Outbox template byte-for-byte after substitution
- Unauthorized / wrong-tenant / forged headers denied with zero leakage (`CROSS_TENANT_LEAKAGE=0`)
- Published version mutation fail-closed
- Missing translation after fallback fail-closed (no invented copy)
- No PII in logs; no LLM statutory decision path
