# SF-M01-W2-003 evidence (CMP-032 Storage)

| Field | Value |
|---|---|
| Task | SF-M01-W2-003 |
| Component | CMP-032 |
| Baseline | `origin/main` @ `f397e13` (plan merge) |
| Implementation SHA | `e0b662e76f8de2fa02af05e1dc8a0557b214433c` |
| Branch | `cursor/m01-w2-cmp-032-1f9a` |
| CERTIFIED | **false** (builder cannot self-certify) |
| Storage mode | SIMULATED/local only (INT-013 markers); no REAL S3/KMS |

## Executed checks

| Check | Result | Artifact |
|---|---|---|
| `@serviceform/storage` unit | PASS (12) | `junit/storage-unit.xml` |
| CMP-032 unit + contract | PASS (9) | `junit/unit.xml` |
| CMP-032 integration | PASS (6) | `junit/integration.xml`, `logs/integration*.log` |
| Typecheck storage + service | PASS | — |
| Scope gate | PASS | — |

## CodeQL remediation (rate limiting)

Auth routes (`POST /storage/objects`, `GET .../access`, `POST .../archive`) now follow CMP-031 dual registration:

- `@fastify/rate-limit` + `fastify-rate-limit` (alias) registered on plugin and each authorize route
- Per-route `config.rateLimit` + `SF-RATE-001` on 429
- Defaults: max 60 / 60s (`SF_STORAGE_RATE_LIMIT_*`)

## Residual for orchestrator (not builder)

CI failures on tip `2e7f943` were **`ERR_PNPM_OUTDATED_LOCKFILE`** for new workspace packages (`packages/storage`, `services/cmp-032-storage`, and `@fastify/rate-limit` importer). Envelope forbids builder commit of `pnpm-lock.yaml`. **Orchestrator must reconcile lockfile** before frozen CI install can pass.

| Failed check | Root cause |
|---|---|
| format/lint/typecheck/unit/contracts/build | outdated lockfile |
| migrations/tenant-isolation | outdated lockfile |
| M01 envelope integration | outdated lockfile |
| web shells smoke/accessibility | outdated lockfile |
| dependency audit | outdated lockfile |
| CodeQL (PR review) | rate-limit — **fixed in builder follow-up** |

## Acceptance mapping

| Acceptance | Evidence |
|---|---|
| Tenant ownership / wrong-tenant denied | `rls-api.int.test.ts` |
| KMS/secret fail closed | `rls-api.int.test.ts` + unit store-service |
| Simulation marker (INT-013) | contract + rls-api |
| Idempotent store | rls-api replay → single outbox ObjectStored |
| Privilege boundary / outbox template | privilege-boundary + contracts.test |
| Rate limiting on auth routes | plugin + route dual register (CMP-031 pattern) |
| Host mount deferred | no `apps/api` writes |
