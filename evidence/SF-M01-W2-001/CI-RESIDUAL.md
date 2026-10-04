# SF-M01-W2-001 CI residual (lockfile)

## Confirmed on tip `e503822` (PR #26) — run `37168289537` / security `37168289485`

| Check | Status / root cause |
|---|---|
| SAST (semgrep) | **PASS** (ReDoS fix on tip `1dd0d76`+) |
| SAST (CodeQL), gitleaks, checkov, architecture gates, flutter, workflows | **PASS** |
| format/lint/typecheck/unit/contracts/build | `ERR_PNPM_OUTDATED_LOCKFILE` — missing importer for `services/cmp-003-jurisdiction/package.json` |
| migrations and tenant-isolation harness | same frozen-lockfile install failure |
| M01 envelope integration | same frozen-lockfile install failure |
| web shells smoke/accessibility | same frozen-lockfile install failure |
| dependency audit | same frozen-lockfile install failure |

**No further in-scope builder code changes available.** Remaining red is 100% lockfile stitch.

## Builder action

- Fixed Semgrep `ajinabraham.njsscan.dos.regex_dos.regex_dos` by replacing `/^[0-9a-f-]{36}$/i` with linear `isUuid()` (also in cursor decode).
- Prettier-formatted component sources under allowed paths.
- **Did not** commit `pnpm-lock.yaml` (envelope `read_only_paths` / orchestrator-owned).

## Orchestrator stitch required

Regenerate `pnpm-lock.yaml` to include workspace importer:

```text
services/cmp-003-jurisdiction:
  dependencies:
    @serviceform/contracts: workspace:*
    @serviceform/observability: workspace:*
    fastify: 5.12.5
    pg: 8.23.1
  devDependencies:
    @types/pg: 8.23.1
```

Until then, CI cannot reach quality/security install stages → not `CI_GREEN`. Builder remains `IMPLEMENTATION_READY`, `self_certified: false`, `not_certified: true`.
