# CMP-003 Jurisdiction Engine

Versioned geographic and administrative jurisdiction hierarchy with containment,
opaque target bindings, and address-key resolution adapters (Eng v1.4).

- Schema: `sf_jurisdiction` (ADR-0006 `sf_cmp003_rw`)
- Organisation hierarchy is **not** owned here (Constitution #2 / CMP-002)
- No hard-coded state/tenant/jurisdiction level names in domain logic
- Host mount deferred to SF-M01-W2-004 (CMP-036)

Rollback: revert the merge for code. Database Down drops `sf_jurisdiction` and
`sf_cmp003_rw` only. Production rollback is forward-fix; Down is for local/CI round trip.

**Not CERTIFIED.** Builder self-certification is false.
