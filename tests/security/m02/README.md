# SF-M02-SEC independent probes

Verifier-owned additive tests. Not product runtime. Not CERTIFIED.

| Artifact | Purpose |
| --- | --- |
| `static-isolation.test.ts` | Frozen 13/13, uniqueness envelope READY, no cross-component SQL, FORCE RLS in migrations, fail-closed authz |
| `forged-tenant-http.test.ts` | INT-011 forged-tenant / client-controlled tenant denial on CMP-004/005 Fastify mounts |
| `fail-closed.test.ts` | Unauthenticated/unauthorized fail-closed; PRODUCTION SIMULATED refused; no PII/secrets in errors/logs |
| `m02-independent-catalog.mjs` | LOGIN-role RLS / privilege catalog. Requires `DATABASE_URL`. Emits `CROSS_TENANT_LEAKAGE`. |

Does not patch `services/**`, `contracts/**`, migrations, grants, or RLS.
