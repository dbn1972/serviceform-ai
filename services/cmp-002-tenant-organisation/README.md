# CMP-002 Tenant and Government Organisation

Metadata-driven tenant, organisation hierarchy, office registry and cell placement
(ADR-0006 `sf_cmp002_rw`). Hosted as a Fastify plugin; CMP-036 (W2) mounts it.

Rollback: revert the merge for code. Database Down drops `sf_tenant_org` and
`sf_cmp002_rw` only. Production rollback is forward-fix; Down is for local/CI round trip.
