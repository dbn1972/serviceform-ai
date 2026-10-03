# Lockfile ownership (M01 Wave 1)

`pnpm-lock.yaml` is **not** a builder write path.

- Builders may change `package.json` (and other manifests) only inside `allowed_write_paths` when the task needs a dependency.
- Builders must not commit `pnpm-lock.yaml`. If `pnpm install` dirties it, restore it before commit.
- `check_scope.py` always refuses `pnpm-lock.yaml` on `agent/*` branches.
- After candidate branches integrate, **orchestrator/integration** regenerates the canonical lockfile once (`pnpm install`), commits it, and runs `pnpm install --frozen-lockfile` plus the relevant test jobs against that lockfile.
- Root `pnpm-workspace.yaml` stays read-only for Wave 1 (`services/*` already includes new component packages).
