# SF-M08-STITCH-B evidence (STITCHED_CANDIDATE, not certified)

- Execution base: `2df9353113b7541d0b9fab81096a4b079c1d2739` (origin/main after #134)
- Branch: `cursor/m08-stitch-b-91f2`
- Authorization: `HUMAN_M08_WAVE_B_THROUGH_EVD_AUTHORIZATION`
- Role: `integration_agent` (serviceform-integration-stitcher), model `claude-opus-5-5`
- CERTIFIED=false, G3=false, G6=false, self_certified=false

## Change

Root `pnpm-lock.yaml`, importers section only (+2/-0):

```diff
+  services/cmp-006-service-discovery: {}
+
```

`services/cmp-006-service-discovery/package.json` declares no dependencies, so the importer is empty.
`packages:` and `snapshots:` are unchanged. No CMP-006 source, migrations, `apps/**`, `contracts/**`,
`orchestrator/contracts-lock.yaml`, `.npmrc`, `pnpm-workspace.yaml` or root `package.json` were edited.
No retention periods were introduced.

## Validation

| Check | Result | Log |
|---|---|---|
| `pnpm install --frozen-lockfile` (stitched) | PASS, lockfile byte-stable | `logs/frozen-install.log` |
| `scripts/gates/run_all.py` | 10/10 PASS | `logs/gates-run-all.log`, `logs/gates-summary.json` |
| `check_scope.py` vs STITCH-B handover (`--base` execution base) | PASS | `logs/check-scope.log` |
| CMP-006 typecheck | PASS | `logs/cmp006-typecheck.log` |
| CMP-006 unit | 51/51 PASS | `logs/cmp006-unit.log` |

The CMP-006 unit config writes JUnit to `evidence/SF-M08-006/junit/unit.xml`; that side effect was
reverted because it is outside this envelope's write scope.

## Observation on base

On the unmodified base, `pnpm install --frozen-lockfile` exits 0 but rewrites the lockfile: it
adds the cmp-006 importer and drops two stray blank lines near `sonic-boom@4.2.1`
(`logs/base-frozen-install-lock-mutation.diff`). The stray blank lines were left untouched to
preserve existing lock bytes; with the importer admitted, install no longer mutates the file.

## Not run

Postgres integration suites, contract validation and full-workspace lint/typecheck/unit were not run
in this mechanical stitch; they belong to downstream INT/EVD tasks.
