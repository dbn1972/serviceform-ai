# SF-M05-SEC independent probes

Verifier-owned additive tests. Not product runtime. Not CERTIFIED. Not G4/G6.

| Artifact | Purpose |
| --- | --- |
| `static-isolation.test.ts` | Frozen 19/19, host/CMP-016/CMP-036, no cross-component SQL, AI/port boundaries, CodeQL query pass-through |
| `forged-tenant-http.test.ts` | INT-011 forged-tenant / client-controlled tenant denial on M05 Fastify mounts |
| `opa-boundaries.test.ts` | OPA fail-closed on case/task/inspection/deficiency/grievance/appeal/SLA; AI statutory=0; CMP-019/028 port boundaries |
| `m05-independent-catalog.mjs` | LOGIN-role RLS / privilege / FORCE RLS / cross-tenant catalog. Requires `DATABASE_URL`. Emits `CROSS_TENANT_LEAKAGE`. |

Does not patch `services/**`, `apps/**`, `contracts/**`, migrations, grants, RLS, package manifests, or lockfiles.
Does not waive CMP-019 / CMP-028 / INT-009 governing residuals.
