# pnpm-lock.yaml stitch summary (SF-M06-STITCH-B)

Compared to authorized execution base `a514ea9b2cef3c535d2b4a312d9df6500ee12dcf`.

## Policy

`pnpm-workspace.yaml` `minimumReleaseAge: 10080`, `trustPolicy: no-downgrade`, `blockExoticSubdeps: true` unchanged. `.npmrc` unchanged. Root `onlyBuiltDependencies` / `ignoredBuiltDependencies` unchanged. No `minimumReleaseAge=0`. No ignore/bypass flags. No lockfile recreation from scratch. No broad `pnpm update`. Naive `pnpm install --lockfile-only` was **not** used.

## Importers added (existing importer bodies NONE changed)

- `services/cmp-021-payment: {}`

Diff vs base: **+2 / −0** lines in `importers:` only (blank line + empty importer). `packages:` and `snapshots:` sections unchanged. Existing package integrity hashes: **0 changes**. Unrelated version upgrades: **0**. Builder-declared external pins: **none** (`@serviceform/cmp-021-payment` package.json has no dependencies).

`pnpm install --frozen-lockfile` **PASS**. Warning only: ignored build scripts `@swc/core@1.16.12` (root `onlyBuiltDependencies` read-only).
`pnpm audit --prod --audit-level high` **PASS** (no known vulnerabilities).

## Lockfile governance basis

- `agent_role: integration_agent`
- `allowed_write_paths` contains exact entry `pnpm-lock.yaml`
- `pnpm-lock.yaml` not matched by `read_only_paths`
