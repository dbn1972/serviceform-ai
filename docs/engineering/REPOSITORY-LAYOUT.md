# Repository layout

| Path | Contents | Owner role |
|---|---|---|
| `apps/api` | Fastify host: config, health/readiness, error envelope, correlation ids, security headers. Components register as plugins. | Platform |
| `apps/web-citizen`, `web-officer`, `web-studio`, `web-admin` | Next.js App Router shells for the five UX4G surfaces (admin = tenant admin + platform ops) | UX4G builder |
| `apps/mobile` | Flutter citizen app; UI only through `lib/ux4g` | UX4G builder |
| `packages/contracts` | Types and validators for `contracts/shared` | Contract Guardian |
| `packages/observability` | Redacting logger, OpenTelemetry bootstrap | Platform |
| `packages/ui-ux4g` | Governed UX4G wrapper, the only home for UI primitives | UX4G builder |
| `services/` | One directory per CMP (from M01) | Component builders |
| `contracts/` | OpenAPI / AsyncAPI / JSON Schema sources; `shared/` envelopes | Contract Guardian |
| `db/` | Migration framework, platform baseline migration, RLS harness | Platform |
| `policy/`, `rules/`, `workflows/` | OPA bundle root, GoRules, workflow model (from M01+) | per component |
| `infra/local` | Docker Compose for local dependencies | Platform |
| `infra/terraform` | IaC skeleton (no resources yet) | Platform |
| `scripts/gates` | Architecture gates and their self-tests | Contract Guardian |
| `tests/e2e`, `tests/semgrep` | Cross-app smoke/accessibility tests, SAST rule tests | Verifiers |
| `evidence/` | Executed evidence records per module/task | Evidence verifier |
| package v2.5 files (`specs/`, `prompts/`, `orchestrator/`, `docs/`, `AGENTS.md`, ...) | Governance baseline | Owner |

Dependency rules (`.dependency-cruiser.cjs`): components never import each other; packages never
import apps or services; web apps never import backend code; no cycles.
