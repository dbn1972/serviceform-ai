# SF-M01-W2-STITCH evidence — Wave 2 integrate + lockfile reconcile

**Decision token: `M01_WAVE2_STITCH_READY`**  
**Not CERTIFIED.** Do **not** merge to `main` from this stitch alone. Independent INT → SEC → EVD remain for the orchestrator.

| Field | Value |
|---|---|
| Task | SF-M01-W2-STITCH |
| Branch | `cursor/m01-w2-stitch-e19b` |
| Tip SHA | `e7881584ba3a032261dbdae898b0e3d6ed98b8e9` |
| Draft PR | https://github.com/dbn1972/serviceform-ai/pull/30 |
| Base | `origin/main` `f397e1319fdf5005b4dfd44e0813d25c5b695ecf` |
| Integrated PRs | #25 #26 #27 #28 #29 |
| Frozen contracts altered | **none** (13/13 MATCH) |
| Self-certified | **false** |
| CERTIFIED | **false** |

## Integrated builder tips

| PR | CMP | Branch | Tip |
|---|---|---|---|
| #25 | CMP-055 | `cursor/m01-w2-cmp-055-0fa8` | `5f574e0` |
| #26 | CMP-003 | `cursor/m01-w2-cmp-003-e34d` | `453e282` |
| #27 | CMP-030 | `cursor/m01-w2-cmp-030-4362` | `78448c7` |
| #28 | CMP-036+047 | `cursor/m01-w2-cmp-036-047-aef8` | `234f1b2` |
| #29 | CMP-032 | `cursor/m01-w2-cmp-032-1f9a` | `13560a9` |

Merges were clean (ort, no conflict resolution inventing policy).

## Stitch-owned work

1. Regenerated `pnpm-lock.yaml` (`pnpm install --config.minimumReleaseAge=0` one-shot; workspace `minimumReleaseAge` / `trustPolicy` unchanged).
2. `pnpm install --frozen-lockfile` **PASS** (25 workspace projects).
3. Phase B host mounts: `apps/api/src/composition/wave2.ts` + `AppDependencies.wave2` for CMP-003 / CMP-030 / CMP-032 (non-literal dynamic import, same pattern as Wave 1).
4. Prettier auto-format on 12 builder files that failed `format:check` on the integrated tree.
5. Minimal eslint stitch fixes (unused import; replace `!` non-null assertions in CMP-032 routes/repos).

## Local executed checks

| Check | Result | Log |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | `logs/frozen-lockfile.log` |
| `pnpm format:check` | PASS | `logs/format-check.log` |
| `pnpm lint` | PASS | `logs/lint-root.log` |
| `pnpm run typecheck` | PASS | `logs/typecheck-root.log` |
| Unit + component contract vitest (81) | PASS | `logs/unit-contract.log` |
| CMP-055 unit (9) | PASS | `logs/cmp-055-unit.log` |
| `contracts:validate` | PASS | `logs/contracts-validate.log` |
| `contracts_lock_gate.py` | PASS 13/13 | `logs/contracts-lock.log` |
| `migration_lint.py` | PASS | `logs/migration_lint.log` |
| `@serviceform/api` build | PASS | `logs/api-build.log` |
| Phase B composition test | PASS | `logs/unit-contract.log` / `junit-unit.xml` |

## Residuals (non-blocking for STITCH_READY)

See `RESIDUALS.md`.

## Explicit non-claims

- Not VERIFIED / Not CERTIFIED
- INT / SEC / EVD not dispatched by this stitch agent
- No merge to `main`
- No frozen contract edits

## Recommended next (orchestrator)

1. Review stitch draft PR CI
2. Dispatch SF-M01-W2-INT → SEC → EVD independently
3. Human/CI gate; still not CERTIFIED unless a separate certification gate says so
