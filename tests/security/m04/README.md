# SF-M04-SEC independent probes

Verifier-owned additive tests. Not product runtime. Not CERTIFIED.

| Artifact | Purpose |
| --- | --- |
| `static-isolation.test.ts` | Frozen 13/13, host/CMP-036 uniqueness, no cross-component SQL, AI/statutory boundaries, uniqueness envelope READY |
| `forged-tenant-http.test.ts` | INT-011 forged-tenant / client-controlled tenant denial on M04 Fastify mounts |
| `fail-closed-ai-doc.test.ts` | OPA fail-closed, PDP unavailable, SIMULATED refuse, statutory AI=0, CMP-014 gateway-only, no secret/PII log leakage |
| `m04-independent-catalog.mjs` | LOGIN-role RLS / privilege / FORCE RLS / cross-tenant catalog. Requires `DATABASE_URL`. Emits `CROSS_TENANT_LEAKAGE`. |

Does not patch `services/**`, `apps/**`, `contracts/**`, migrations, grants, or RLS.
