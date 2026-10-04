# SF-M03-003 implementation plan — CMP-034 Master Data Service

Status: **IMPLEMENTATION_READY** (builder recommendation). **Not VERIFIED. Not CERTIFIED.**

| Field | Value |
|---|---|
| Task | SF-M03-003 |
| Component | CMP-034 |
| Integrations | INT-002 (component publish/immutability), INT-011, INT-013 (import adapter) |
| Builder | serviceform-studio-builder |
| Branch | `cursor/m03-masterdata-sf-m03-003-2c63` |
| Base | `origin/main` `bd14a4a05fef03a7621a0bf27bc3cbac876b354b` |
| Schema | `sf_master_data` |
| Privilege role | `sf_cmp034_rw` NOLOGIN (ADR-0006 Option A) |
| Self-certification | **false** |

## Impact

- **Domain:** Generic tenant-scoped code sets, effective-dated draft/published versions, bulk import, opaque target bindings. No named-service or geographic-level branching. Localization keys and jurisdiction refs are opaque (CMP-053 / CMP-003 ports; no SQL).
- **Data:** `sf_master_data` only; FORCE RLS; `sf_migrator` owner; DML via `sf_cmp034_rw`. Outbox copied from frozen template.
- **INT-002:** Draft → validate → publish. Published versions and values are immutable (trigger + service). Bindings pin published versions only. Maker-checker workflow remains CMP-051.
- **INT-013:** DEPARTMENT_API import adapter. SIMULATED allowed in LOCAL/CI (+ matching env). PRODUCTION SIMULATED fail-closed. REAL/SANDBOX fail-closed (adapter not shipped). Adapter runs **outside** the DB transaction.
- **Host mount:** deferred to SF-M03-008.

## Rollback

Revert the merge for code. Down drops `sf_master_data` and `sf_cmp034_rw` only. Production rollback is forward-fix.
