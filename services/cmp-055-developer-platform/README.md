# CMP-055 Developer Platform

Engineering platform slice for ServiceForm AI (Eng v1.4 CMP-055).

## Responsibilities (this wave)

- Repo/CI conventions and additive quality gates (no gate weakening)
- OpenAPI/AsyncAPI pipeline helpers for **component-local** contracts (never mutates `contracts/shared/**`)
- AI agent instruction packaging checks under approved paths only
- Provenance / evidence-manifest helpers (SBOM hooks remain in security workflow)

## Explicit non-responsibilities

- Does not silently change architecture, ADRs, or frozen contracts
- Does not let generated code bypass tests/security gates
- Does not own domain services or migrations (`db/migrations` remains authoritative; see CR-13)

## Commands

`package.json` is deferred until orchestrator lockfile reconcile (envelope forbids builder
`pnpm-lock.yaml` commits). Sources/tests are still first-class under this tree.

```bash
pnpm exec tsc --noEmit -p services/cmp-055-developer-platform/tsconfig.json
pnpm exec vitest run services/cmp-055-developer-platform/test
python3 scripts/gates/openapi_asyncapi_gate.py
python3 scripts/gates/workflow_pin_gate.py
python3 scripts/gates/run_all.py
```

## Related gates

| Gate | Role |
|---|---|
| `migration_lint.py` | Authoritative migrations under `db/migrations` only (CR-13) |
| `openapi_asyncapi_gate.py` | Component OpenAPI/AsyncAPI structural lint |
| `workflow_pin_gate.py` | Pin-safe, secret-free workflow conventions |
| `contracts_lock_gate.py` | Frozen shared contracts (unchanged; still mandatory) |
| `agent_rules_gate.py` | AGENTS / Cursor / Claude instruction surfaces |

**Not CERTIFIED** by this component. Independent verifiers own gate recommendation.
