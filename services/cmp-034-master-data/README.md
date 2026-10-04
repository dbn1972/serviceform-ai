# CMP-034 Master Data Service

Generic, tenant-scoped code sets with effective-dated versions, bulk import, and
opaque bindings (Eng v1.4). Host mount is deferred to SF-M03-008.

- Schema: `sf_master_data` (ADR-0006 `sf_cmp034_rw`)
- Published versions are insert-then-publish and then immutable
- No named-service or geographic-level branching
- Localization and jurisdiction are opaque refs (CMP-053 / CMP-003 ports; no SQL)
- INT-013: connector import is SIMULATED in LOCAL/CI and fail-closed in PRODUCTION

Rollback: revert the merge for code. Database Down drops `sf_master_data` and
`sf_cmp034_rw` only. Production rollback is forward-fix.

**Not CERTIFIED.** Builder self-certification is false.
