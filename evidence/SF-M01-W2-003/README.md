# SF-M01-W2-003 evidence (CMP-032 Storage)

| Field | Value |
|---|---|
| Task | SF-M01-W2-003 |
| Component | CMP-032 |
| Baseline | `origin/main` @ `f397e13` (plan merge) |
| Branch | `cursor/m01-w2-cmp-032-1f9a` |
| CERTIFIED | **false** (builder cannot self-certify) |
| Storage mode | SIMULATED/local only (INT-013 markers); no REAL S3/KMS |

## Executed checks

| Check | Result | Artifact |
|---|---|---|
| `@serviceform/storage` unit | PASS (12) | `junit/storage-unit.xml` |
| CMP-032 unit + contract | PASS (8) | `junit/unit.xml` |
| CMP-032 integration | PASS (6) | `junit/integration.xml`, `logs/integration.log` |
| Typecheck storage + service | PASS | — |

## Acceptance mapping

| Acceptance | Evidence |
|---|---|
| Tenant ownership / wrong-tenant denied | `rls-api.int.test.ts` |
| KMS/secret fail closed | `rls-api.int.test.ts` + unit store-service |
| Simulation marker (INT-013) | contract + rls-api |
| Idempotent store | rls-api replay → single outbox ObjectStored |
| Privilege boundary / outbox template | privilege-boundary + contracts.test |
| Host mount deferred | no `apps/api` writes |

## Notes

- `pnpm-lock.yaml` not committed (orchestrator lockfile policy).
- Host composition deferred to SF-M01-W2-004.
