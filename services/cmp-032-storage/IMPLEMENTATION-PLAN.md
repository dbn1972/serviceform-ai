# SF-M01-W2-003 CMP-032 Storage — implementation plan

## Scope

- `packages/storage`: SIMULATED/local object-store port, keys, checksums, INT-013 markers, presign helpers
- `services/cmp-032-storage`: Fastify plugin, metadata + policy, outbox events
- `db/migrations/*_cmp-032-*.sql`: `sf_storage`, `sf_cmp032_rw`, SF-CON-OUTBOX template copy

## Acceptance (builder evidence; not CERTIFIED)

1. Tenant/cell ownership in metadata; wrong-tenant access denied (RLS + authz)
2. KMS/secret port failure fails closed (`SF-SYS-004`)
3. Simulation marker present for SIMULATED mode (SF-CON-SIMULATION-MARKER)
4. Duplicate store command does not duplicate durable side effects (idempotency)
5. ADR-0006 privilege-boundary; outbox template unchanged after `{schema}/{cmp}`
6. Host mount deferred to SF-M01-W2-004

## Stop conditions honored

- No frozen shared contract edits
- No REAL S3/KMS / `infra/**`
- No writes outside allowed paths
- `self_certified: false`, `not_certified: true`
