# SF-M03-SEC independent probes

Verifier-owned additive tests. Not product runtime. Not CERTIFIED.

| Artifact | Purpose |
| --- | --- |
| `static-isolation.test.ts` | Frozen 13/13, host/Studio/UX4G boundaries, no cross-component SQL, published-version guards, uniqueness envelope READY |
| `forged-tenant-http.test.ts` | INT-011 forged-tenant / client-controlled tenant denial on M03 Fastify mounts |
| `studio-ux4g-boundary.test.ts` | CMP-050 BFF session isolation; CMP-054 overlay leakage = 0; no Fastify plugin |
| `m03-independent-catalog.mjs` | LOGIN-role RLS / privilege / published-immutability catalog. Requires `DATABASE_URL`. Emits `CROSS_TENANT_LEAKAGE`. |

Does not patch `services/**`, `contracts/**`, migrations, grants, or RLS.
