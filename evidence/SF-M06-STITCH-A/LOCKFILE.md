# pnpm-lock.yaml stitch summary (SF-M06-STITCH-A)

Compared to authorized execution base `c5f90d56988c4f988133c99643ff2ab96b53997c`.

## Policy

`pnpm-workspace.yaml` `minimumReleaseAge: 10080`, `trustPolicy: no-downgrade`, `blockExoticSubdeps: true` unchanged. `.npmrc` unchanged. Root `onlyBuiltDependencies` / `ignoredBuiltDependencies` unchanged. No `minimumReleaseAge=0`. No ignore/bypass flags. No lockfile recreation from scratch. No broad `pnpm update`. Naive `pnpm install --lockfile-only` was **not** used.

## Importers added (existing importer bodies NONE changed)

- `services/cmp-020-fee-calculation: {}`
- `services/cmp-025-notification: {}`
- `services/cmp-026-communication-messaging: {}`

Diff vs base: **+6 / −0** lines in `importers:` only. `packages:` and `snapshots:` sections unchanged. Existing package integrity hashes: **0 changes**. Unrelated version upgrades: **0**. Builder-declared external pins: **none**.

`pnpm install --frozen-lockfile` **PASS**. Warning only: ignored build scripts `@swc/core@1.16.12` (root `onlyBuiltDependencies` read-only).
`pnpm audit --prod --audit-level high` **PASS** (no known vulnerabilities).
