# SF-M01-W2-001 CI residual (lockfile)

## Failed checks on tip `5abef0a` (PR #26)

| Check | Root cause |
|---|---|
| format/lint/typecheck/unit/contracts/build | `ERR_PNPM_OUTDATED_LOCKFILE` — missing importer for `services/cmp-003-jurisdiction/package.json` |
| migrations and tenant-isolation harness | same frozen-lockfile install failure |
| M01 envelope integration | same frozen-lockfile install failure |
| web shells smoke/accessibility | same frozen-lockfile install failure |
| dependency audit | same frozen-lockfile install failure |
| SAST (semgrep) | **in-scope fix applied** — ReDoS rule on UUID regex in `resolve.ts` |

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
