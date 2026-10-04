# SF-M01-W2-005 plan (executed)

| Field | Value |
|---|---|
| Task | SF-M01-W2-005 |
| Component | CMP-055 Developer Platform |
| Baseline | `origin/main` @ `f397e1319fdf5005b4dfd44e0813d25c5b695ecf` (Wave 2 plan merge) |
| Branch | `cursor/m01-w2-cmp-055-0fa8` |
| Self-certified | false |
| CERTIFIED | false |

## Scope delivered

1. **CR-13** — `migration_lint.py` defaults to `db/migrations` only; fails closed on `services/*/migrations/*.sql`
2. **OpenAPI/AsyncAPI pipeline** — TS helpers + `openapi_asyncapi_gate.py` for component-local contracts only
3. **Workflow hygiene** — `workflow_pin_gate.py` (SHA-pinned `uses:`, no plaintext secrets)
4. **Agent packaging** — approved-path allowlist helper (complements `agent_rules_gate`)
5. **Provenance** — evidence-manifest builder that cannot claim CERTIFIED / self_certified
6. **Additive workflow** — `.github/workflows/developer-platform.yml` (does not weaken `ci.yml` / `security.yml`)

## Non-goals

- No frozen contract edits
- No constitution / ADR changes
- No domain service ownership
- No `pnpm-lock.yaml` commit
- No CERTIFIED claim
