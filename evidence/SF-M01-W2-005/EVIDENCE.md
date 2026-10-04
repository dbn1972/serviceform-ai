# SF-M01-W2-005 evidence (builder; not CERTIFIED)

| Field | Value |
|---|---|
| Task | SF-M01-W2-005 |
| Component | CMP-055 |
| Baseline SHA | `f397e1319fdf5005b4dfd44e0813d25c5b695ecf` |
| Result commit | _(filled after commit)_ |
| Self-certified | **false** |
| CERTIFIED | **false** |
| Recommended gate | READY_FOR_INDEPENDENT_VERIFY |

## Executed checks (local)

| Check | Result | Log |
|---|---|---|
| `python3 -m pytest scripts/gates/tests -q` | 22 passed | `logs/gate-self-tests.log` |
| `python3 scripts/gates/run_all.py` | 9/9 passed | `logs/gates.log` |
| `pnpm exec tsc --noEmit -p services/cmp-055-developer-platform/tsconfig.json` | pass | `logs/typecheck.log` |
| `pnpm exec vitest run services/cmp-055-developer-platform/test` | 9 passed | `logs/unit.log` / `junit/unit.xml` |
| `python3 scripts/gates/check_scope.py` | pass | `logs/scope-check.log` |
| `python3 scripts/gates/contracts_lock_gate.py` | 13/13 FROZEN | included in gates.log |

## Artifacts

- `evidence/SF-M01-W2-005/PLAN.md`
- `evidence/SF-M01-W2-005/EVIDENCE.md`
- `evidence/SF-M01-W2-005/junit/unit.xml`
- `evidence/SF-M01-W2-005/logs/*`
- `orchestrator/handovers/SF-M01-W2-005.yaml`

## Notes

- Additive gates only; existing security thresholds unchanged.
- `package.json` deferred to avoid forbidden lockfile commit; sources/tests still run via path configs.
- Independent architecture-guardian / evidence-verifier / stitcher not performed by this builder.
