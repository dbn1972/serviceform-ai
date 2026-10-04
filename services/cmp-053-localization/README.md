# CMP-053 Localization Service

Tenant-scoped translation catalogs, locale fallback, and date/number format profiles
(Eng v1.4 CMP-053). Host mount is deferred to SF-M03-008.

- Schema: `sf_localization` (ADR-0006 `sf_cmp053_rw`)
- Published catalog versions are immutable (Constitution #8)
- No named-service branching; catalog codes and locale tags are metadata
- No LLM statutory eligibility, approval, or rejection
- Optional translation assist is SIMULATED/fail-closed (INT-013); it never writes published catalogs

Rollback: revert the merge for code. Database Down drops `sf_localization` and
`sf_cmp053_rw` only.

**Not CERTIFIED.** Builder self-certification is false.
