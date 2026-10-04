# SF-M03-002 CMP-033 Metadata — implementation plan

## Scope

- `services/cmp-033-metadata`: Fastify plugin, draft/validate/compose/publish-immutability
- `db/migrations/*_cmp-033-*.sql`: `sf_metadata`, `sf_cmp033_rw`, SF-CON-OUTBOX template copy

## Acceptance (builder evidence; not CERTIFIED)

1. Tenant isolation (INT-011): RLS + OPA port; client tenant headers rejected; CROSS_TENANT_LEAKAGE=0
2. Schema registry port failure fails closed (`SF-SYS-004`); SIMULATED forbidden in PRODUCTION (INT-013)
3. Simulation marker present for SIMULATED validation (SF-CON-SIMULATION-MARKER)
4. Idempotent create; published-version mutation refused
5. ADR-0006 privilege-boundary; outbox template unchanged after `{schema}/{cmp}`
6. Host mount / Studio UI deferred (SF-M03-008 / SF-M03-007)

## Stop conditions honored

- No frozen shared contract edits / no `pnpm-lock.yaml`
- No policy invention; kinds are generic platform metadata
- No writes outside allowed paths
- `self_certified: false`, `not_certified: true`
