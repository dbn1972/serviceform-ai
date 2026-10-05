# pnpm-lock.yaml stitch record (SF-M05-STITCH-A)

Sole Wave A lockfile writer. Compared to `origin/main` `6e9f0481eb3007dedee5580838cab59ceea66f03`: **+1191 / −0** lines. No existing package, snapshot, importer or integrity hash changed. No unrelated version moves. Commit `2d06259aacd3a8d4abebe48d8b97de63ef952063`.

## Why a scripted merge (not `pnpm install --lockfile-only`)

`pnpm install --lockfile-only` on the combined workspace (policy unchanged) fails before touching Wave A:

`ERR_PNPM_NO_MATURE_MATCHING_VERSION Version 8.23.1 (released 4 days ago) of pg does not meet the minimumReleaseAge constraint` (direct dependency of `apps/api`, already locked on main).

A filtered run (`--filter` the four Wave A packages) fails the same way on root `eslint-plugin-security@4.2.0` (also already locked on main). Both are pre-existing main pins, unrelated to Wave A. Policy was **not** waived. Same situation and remedy as SF-M04-STITCH-A.

## Procedure (reproducible: `tooling/`)

1. Isolated probe workspace (`/tmp/probe`) with byte-identical `.npmrc` and `pnpm-workspace.yaml` (`minimumReleaseAge: 10080`, `trustPolicy: no-downgrade`, `blockExoticSubdeps: true`, `min-release-age=7`), root `pnpm`/`engines`/`packageManager` copied (`tooling/probe-root-package.json`), and the exact `services/cmp-016-workflow-engine/package.json`. `pnpm install --lockfile-only` → **PASS**, 159 packages resolved, no maturity/trust/exotic error.
2. `tooling/merge.mjs` (parser `tooling/lockparse.mjs`) merges into main's lockfile:
   - verifies main's lockfile round-trips byte-identically through the parser first;
   - adds importer `services/cmp-016-workflow-engine` verbatim from the probe and empty importers (`{}`, pnpm's own format) for CMP-015/017/029, which declare no dependencies;
   - adds only `packages`/`snapshots` keys absent from main (110 + 110); keys already on main are left untouched (49 packages / 48 snapshots identical);
   - inserts at code-point position without reordering any existing entry.
3. One key collided: snapshot `protobufjs@7.6.6` (probe linked `@types/node@26.6.3`; main links `@types/node@22.20.5`). Main's entry was **kept unchanged**.
4. `pnpm install --frozen-lockfile` → **PASS** (`logs/frozen-lockfile.log`).

Machine report: `logs/lockfile-merge-report.json`. Hashes: `logs/lockfile-sha256.txt`.

## Importers added

- `services/cmp-015-application-case: {}`
- `services/cmp-016-workflow-engine` — dependencies `@temporalio/activity`, `@temporalio/client`, `@temporalio/common`, `@temporalio/worker`, `@temporalio/workflow` **1.24.0**; devDependency `@temporalio/testing` **1.24.0** (exact; not removed or downgraded)
- `services/cmp-017-work-queue-tasks: {}`
- `services/cmp-029-sla-escalation: {}`

## New resolved packages

110 packages: the Temporal 1.24.0 family (`activity`, `client`, `common`, `core-bridge`, `nexus`, `proto`, `testing`, `worker`, `workflow`), `@grpc/grpc-js@1.14.5`, `@swc/core@1.16.2` (+ optional platform binaries), `webpack@5.111.1`, `swc-loader@0.2.7`, `source-map-loader@5.0.0`, `memfs`, `unionfs`, `nexus-rpc@0.0.3`, `protobufjs@8.8.0` and transitive support.

New versions of names already on main (coexist; main entries untouched): `@types/node@26.6.3`, `undici-types@8.9.0` (via `jest-worker`), `commander@2.20.3`, `ms@3.0.0-canary.1` (Temporal pin), `protobufjs@8.8.0`, `supports-color@8.1.1`, and policy-mature patch siblings `baseline-browser-mapping@2.11.26`, `caniuse-lite@1.0.30001812`, `enhanced-resolve@5.25.1`, `source-map-js@1.2.1` (main's newer versions are younger than 7 days, so the probe chose mature ones).

## Build scripts

pnpm reports `Ignored build scripts: @swc/core@1.16.2` (default deny; root `onlyBuiltDependencies` unchanged and outside the stitch write set). The postinstall only validates the native binding; the binding ships via the optional platform package. The Temporal SDK suite bundled the workflow with webpack + `swc-loader` successfully (`logs/cmp-016-temporal-sdk.log`).

## Licences (newly admitted, installed on linux-x64: 99 of 110)

MIT 57, Apache-2.0 30, BSD-3-Clause 6, Apache-2.0 AND MIT 1, BSD-2-Clause 1, ISC 1, CC-BY-4.0 1 (`caniuse-lite` data), Unlicense 1 (`fs-monkey`), no `license` field 1 (`unionfs@4.6.0`, ships an Unlicense LICENSE file). The 11 not installed here are other-OS `@swc/core-*` binaries. No copyleft. `logs/licences-new-packages.json`. CI licence/SBOM step (cdxgen) runs in the security workflow.

## Audit

- `pnpm audit --prod --audit-level high`: **no known vulnerabilities** (`logs/pnpm-audit-prod.log`).
- `pnpm audit --audit-level moderate` (all): 1 high, `braces` via `.>@next/eslint-plugin-next>fast-glob>micromatch>braces` (dev only, no patched version). **Identical on base `6e9f048`**; not introduced by this stitch; report-only in CI (`logs/pnpm-audit-all.log`).

## Controls (unchanged)

`.npmrc`, `pnpm-workspace.yaml`, root `package.json`: 0-line diff vs base. No `minimumReleaseAgeExclude`. Frozen-lockfile CI, audit, licence and SBOM steps not weakened.
