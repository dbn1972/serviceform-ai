# Tenancy and Jurisdiction Invariants

1. Resolve tenant and actor context before domain execution.
2. Every tenant-owned row carries `tenant_id`; global data is explicitly classified.
3. Enforce PostgreSQL RLS or equivalent defense-in-depth in addition to application authorization.
4. Include tenant namespace in cache keys, search documents/index aliases, object paths, events and AI retrieval filters.
5. Organization hierarchy and jurisdiction hierarchy are independent trees/graphs.
6. Provider binding resolves competent office/authority from offering + applicant/service geography, not hard-coded names.
7. Cross-tenant analytics uses authorized/de-identified aggregate pipelines, not ad hoc production queries.
8. Tenant export/exit is mandatory and uses documented open formats.
