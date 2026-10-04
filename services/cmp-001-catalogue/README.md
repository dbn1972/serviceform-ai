# CMP-001 Service Catalogue & Registry

Canonical service definitions/categories and tenant-local offerings with opaque
provider/jurisdiction bindings (Eng v1.4). Metadata and generic codes only —
no named-service branching.

- Schema: `sf_catalogue` (ADR-0006 `sf_cmp001_rw`)
- Published versions are immutable; this component never writes a published pin
  without the `CATALOGUE_PIN` session marker (CMP-052 / SF-M03-004).
- Host mount deferred to SF-M03-008.
- **Not CERTIFIED.**

Rollback: revert the merge for code. Database Down drops `sf_catalogue` and
`sf_cmp001_rw` only. Production rollback is forward-fix; Down is for local/CI round trip.
