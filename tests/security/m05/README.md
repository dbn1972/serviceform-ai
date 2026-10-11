# SF-M05-SEC-RERUN independent probes

Verifier-owned additive tests for LOCK-8 post-remediation rerun on `4d99c91e`.
Not product runtime. Not CERTIFIED. Not G4/G6. Production READ ONLY.

| Artifact | Purpose |
| --- | --- |
| `static-isolation.test.ts` | Frozen 19/19; REM-002 host admission + supply-chain; CMP-016/CMP-036; no cross-component SQL; CodeQL pass-through |
| `forged-tenant-http.test.ts` | INT-011 forged-tenant / client-controlled tenant denial on M05 Fastify mounts |
| `opa-boundaries.test.ts` | OPA fail-closed on case/task/inspection/deficiency/grievance/appeal/SLA; AI statutory=0; CMP-019/028 port boundaries |
| `reconciliation-security.test.ts` | REM-001 durable recon: stale→FAILED_STALE; no network in auth txn; ports only; tenant isolation |
| `m05-independent-catalog.mjs` | LOGIN-role RLS / FORCE RLS / reconciliation_intent TI. Requires `DATABASE_URL`. Emits `CROSS_TENANT_LEAKAGE`. |

Does not patch `services/**`, `apps/**`, `contracts/**`, migrations, grants, RLS, package manifests, or lockfiles.
Does not waive CMP-019 / CMP-028 governing residuals. Evidence → `evidence/SF-M05-SEC-RERUN/**`.
