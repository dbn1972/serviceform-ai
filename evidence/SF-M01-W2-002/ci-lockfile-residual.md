# SF-M01-W2-002 CI residual — frozen lockfile / workspace importer

**CERTIFIED:** false  
**Thresholds weakened:** false  
**Write-path expansion:** false  

## Verdict

All five red PR #27 checks on tip `9f8d73712c0ed6d17d86a5b9a3fb768f718da20c` fail at **`pnpm install --frozen-lockfile`** with the same root cause. No CMP-030 production/test code failure was reached.

## Failed checks (run `37168138948` / security `37168138907`)

| Check | Root cause |
|---|---|
| format, lint, typecheck, unit, contracts, build | `ERR_PNPM_OUTDATED_LOCKFILE` |
| migrations and tenant-isolation harness | same |
| M01 envelope integration (SF-M01-001..005) | same |
| web shells smoke and accessibility | same |
| dependency audit | same |

## Exact failure

```text
ERR_PNPM_OUTDATED_LOCKFILE
Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date with
  <ROOT>/services/cmp-030-consent-privacy/package.json

Failure reason:
  specifiers in the lockfile don't match specifiers in package.json:
  * 5 dependencies were added:
      @types/pg@8.23.1,
      @serviceform/contracts@workspace:*,
      @serviceform/observability@workspace:*,
      fastify@5.12.5,
      pg@8.23.1
```

## Why builder cannot clear this

Envelope `SF-M01-W2-002` (`allowed_write_notes` + `read_only_paths`):

- **Do not commit `pnpm-lock.yaml`**
- `pnpm-lock.yaml` is orchestrator/integration owned

Adding `@serviceform/cmp-030-consent-privacy` under `services/*` correctly requires a lockfile importer entry. Committing that entry would violate the envelope scope gate.

## Orchestrator stitch action required

1. Regenerate `pnpm-lock.yaml` on this branch (or a stitch branch) so the CMP-030 workspace package importers/specifiers match `services/cmp-030-consent-privacy/package.json`.
2. Re-run CI; expect install to proceed. Builder-local evidence already shows typecheck + 12 unit/contract + 6 integration PASS on disposable PG16.
3. Do **not** ask CMP-030 builder to expand write paths or weaken gates.

## Non-residuals (already green / unrelated)

- Architecture gates, gitleaks, Semgrep, CodeQL, Checkov, Flutter, workflow/compose/terraform validation passed on the same tip.
- No DPDP/statutory content changes contemplated.
