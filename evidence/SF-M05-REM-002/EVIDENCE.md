# SF-M05-REM-002 evidence — API host M05 package admission

**Not CERTIFIED. Not VERIFIED. Not RELEASE CERTIFIED. Not G4. Not G6.** Builder self-certification is false. **DO NOT MERGE** without separate merge authorization. EVD OFF. INT/SEC rerun not started by this lane. REM-001 not started by this lane.

| Field | Value |
|---|---|
| Task | SF-M05-REM-002 (LOCK-8 production remediation — host package) |
| Authorization | `HUMAN_SF_M05_LOCK8_PRODUCTION_REMEDIATION_AUTHORIZATION` |
| SHA guard | **PASS** — `origin/main` = `c0d25b32114779ddb4cc23e4e62a25f9d1365192` |
| Branch | `cursor/m05-rem-hostpkg-c0d25b32` |
| Write set | `apps/api/package.json`, `pnpm-lock.yaml`, `evidence/SF-M05-REM-002/**`, `orchestrator/tasks/SF-M05-REM-002.yaml`, `orchestrator/handovers/SF-M05-REM-002.yaml` |
| Contracts | **19/19 FROZEN MATCH** |
| CMP-016 admitted | **false** |
| CMP-036 re-added | **false** (single existing declaration retained) |

## Scope delivered

Exactly seven `@serviceform/api` `workspace:*` dependencies admitted:

1. `@serviceform/cmp-015-application-case`
2. `@serviceform/cmp-017-work-queue-tasks`
3. `@serviceform/cmp-018-inspection-verification`
4. `@serviceform/cmp-019-deficiency`
5. `@serviceform/cmp-027-grievance-feedback`
6. `@serviceform/cmp-028-appeal-review`
7. `@serviceform/cmp-029-sla-escalation`

Lockfile: importer-only admission under `importers.apps/api` (21 added lines). `packages:` and `snapshots:` sections **byte-identical** to execution base. No supply-chain policy relaxation.

## Proof — package-specifier resolution without `.ts` file-URL fallback

Composition `m05.ts` still contains a pre-lockfile file-URL fallback (read-only; not modified). After admission, the **package specifier alone** resolves and loads:

| Proof | Result | Artifact |
|---|---|---|
| `import.meta.resolve(pkg)` from `apps/api` | PASS — workspace service link; not composition-relative file URL | `proof/import-meta-resolve.json` |
| `tsx` `import(pkg)` (host runtime) | PASS — all seven | `proof/tsx-package-specifier-import.json` |
| loadModule-equivalent **specifier-only** (fallback never attempted) | PASS | `proof/load-by-specifier-only.json` |
| `apps/api` build | PASS — undeclared runtime deps = 0 | `logs/api-build.log` |
| `composition-m05` vitest | PASS 13/13 | `logs/composition-m05.log` |

`M05_HOST_PACKAGE_ADMISSION` remediation status: **ADMITTED** (deployable package-specifier path proven; no `apps/api/src/**` or `build.mjs` changes).

## Lockfile audit

See `LOCKFILE.md`, `LOCKFILE.importer.diff`, `package.json.diff`.

| Section | vs `c0d25b32` |
|---|---|
| importers (`apps/api`) | +21 lines (seven workspace links) |
| packages | **byte-identical** |
| snapshots | **byte-identical** |

## Commands (executed)

```bash
git fetch origin main  # = c0d25b32114779ddb4cc23e4e62a25f9d1365192
pnpm install --frozen-lockfile
python3 scripts/gates/contracts_lock_gate.py
python3 scripts/gates/run_all.py
pnpm --filter @serviceform/api build
pnpm exec vitest run apps/api/test/composition-m05.test.ts
# plus proof scripts under evidence/SF-M05-REM-002/proof/
```

## Results (builder-executed)

| Check | Result |
|---|---|
| SHA guard | PASS |
| frozen-lockfile | PASS |
| contracts lock | PASS **19/19 FROZEN MATCH** |
| architecture gates | PASS 10/10 |
| api build | PASS |
| composition-m05 | PASS 13/13 |
| package-specifier proof | PASS |
| packages-section churn | **0** |
| snapshots-section churn | **0** |

## Explicit non-claims

- Not CERTIFIED / Not G4 / Not G6 / Not self-certified
- Do not merge this PR
- Did not start REM-001 / EVD / INT rerun / SEC rerun
- Did not modify `apps/api/src/**`, `apps/api/scripts/build.mjs`, services, contracts, migrations, `.npmrc`, `pnpm-workspace.yaml`
- Did not waive CMP-019 or CMP-028
