# pnpm-lock.yaml stitch summary (SF-M05-STITCH-A)

Compared to authorized execution base `df028c71035d584601e1c6a860c75d7bb7d2bd22`.

## Policy

`pnpm-workspace.yaml` `minimumReleaseAge: 10080`, `trustPolicy: no-downgrade`, `blockExoticSubdeps: true` unchanged. `.npmrc` unchanged. Root `onlyBuiltDependencies` / `ignoredBuiltDependencies` unchanged. No `minimumReleaseAge=0`. No ignore/bypass flags. No lockfile recreation from scratch. No broad `pnpm update`.

Naive `pnpm install --lockfile-only` on the monorepo was **not** used (would re-resolve existing `pg-cloudflare@1.4.1` and `@next/swc-*` against minimumReleaseAge).

## Importers added (existing importer bodies NONE changed)

- `services/cmp-015-application-case: {}`
- `services/cmp-016-workflow-engine` — `@temporalio/{activity,client,common,worker,workflow}@1.24.0` plus `@temporalio/testing@1.24.0` (dev)
- `services/cmp-017-work-queue-tasks: {}`
- `services/cmp-029-sla-escalation: {}`

## Temporal admission

Isolated probe `/tmp/temporal-lock-probe` with the **same** supply-chain controls resolved `@temporalio/*@1.24.0` (published 2026-09-15, mature vs 7-day age) plus genuine worker transitives (webpack/swc/memfs graph).

Existing package integrity hashes: **0 changes**. Existing snapshot bodies: **0 changes**. Removed existing entries: **0**. Unrelated version upgrades of packages already on main: **0**. `pg-cloudflare@1.4.1` and all `@next/swc-*@16.3.8` **UNCHANGED**.

`@types/node@26.6.3` from the isolated probe was **not** admitted; protobufjs/jest-worker snapshots reuse locked `@types/node@22.20.5`.

`source-map-loader@5.0.0` range `source-map-js@^1.0.2` was retargeted to existing locked `source-map-js@1.2.2` (not new 1.2.1). `pnpm audit --prod --audit-level high` **PASS**.

`pnpm install --frozen-lockfile` **PASS**. Warning only: ignored build scripts `@swc/core@1.16.12` (root `onlyBuiltDependencies` read-only; platform optional packages still present).
