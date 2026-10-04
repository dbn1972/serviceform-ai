# M01 G4 security verification probes

Additive, verifier-owned probes for `SF-M01-G4-003`. Not product runtime code.

| Artifact | Purpose |
|---|---|
| `m01-g4-independent-catalog.mjs` | LOGIN-role privilege / FORCE RLS / cross-component SQL / tenant-isolation catalog for all M01 DB components |

Requires `DATABASE_URL` to a disposable PostgreSQL 16. Emits `CROSS_TENANT_LEAKAGE` in the catalog summary JSON.
