# SF-M08-STITCH-A evidence (STITCHED_CANDIDATE, not certified)

- Execution base: `d5f01a1a63391d4bb39176537441e70cb12d275e` (origin/main after #132)
- Branch: `cursor/m08-stitch-a-91f2`
- Authorization: `HUMAN_SF_M08_STITCH_A_AUTHORIZATION`
- Role: `integration_agent` (serviceform-integration-stitcher), model `claude-opus-5-5`
- CERTIFIED=false, G3=false, G6=false, self_certified=false

## Change

Root `pnpm-lock.yaml`, importers section only (+2/-0):

```diff
+  services/cmp-049-data-retention: {}
+
```

`services/cmp-049-data-retention/package.json` declares no dependencies, so the importer is empty.
CMP-035/007/045/046 importers were already present on base. `packages:` and `snapshots:` are unchanged.
No Wave A source, migrations, `apps/**`, `contracts/**`, `orchestrator/contracts-lock.yaml`,
`.npmrc`, `pnpm-workspace.yaml` or root `package.json` were edited. No retention periods were introduced.

## Validation

| Check | Result | Log |
|---|---|---|
| `pnpm install --frozen-lockfile` (stitched) | PASS, lockfile byte-stable | `logs/frozen-install.log` |
| `scripts/gates/run_all.py` | 10/10 PASS | `logs/gates-run-all.log`, `logs/gates-summary.json` |
| `check_scope.py` vs STITCH-A handover | PASS | `logs/check-scope.log` |
| CMP-049 typecheck | PASS | `logs/cmp049-typecheck.log` |
| CMP-049 unit | 68/68 PASS | `logs/cmp049-unit.log` |

## Observation on base

On the unmodified base, `pnpm install --frozen-lockfile` exits 0 but rewrites the lockfile: it
adds the cmp-049 importer and drops two stray blank lines near `sonic-boom@4.2.1`
(`logs/base-frozen-install-lock-mutation.diff`). The stray blank lines were left untouched here to
preserve existing lock bytes; with the importer admitted, install no longer mutates the file.

## Not run

Postgres integration suites, contract validation and full-workspace lint/typecheck/unit were not run
in this mechanical stitch; they belong to downstream INT/EVD tasks.
