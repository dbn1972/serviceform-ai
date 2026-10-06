# pnpm-lock.yaml stitch summary (SF-M05-STITCH-B)

Compared to authorized execution base `ca57057a794739c03d0a46886577e25adf041815`.

## Policy

`pnpm-workspace.yaml` `minimumReleaseAge: 10080`, `trustPolicy: no-downgrade`, `blockExoticSubdeps: true` unchanged. `.npmrc` unchanged. Root `onlyBuiltDependencies` / `ignoredBuiltDependencies` unchanged. No `minimumReleaseAge=0`. No ignore/bypass flags. No lockfile recreation from scratch. No broad `pnpm update`.

Naive `pnpm install --lockfile-only` was **not** used (would re-resolve existing packages against minimumReleaseAge).

## Importers added (existing importer bodies NONE changed)

- `services/cmp-018-inspection-verification: {}`
- `services/cmp-019-deficiency: {}`
- `services/cmp-027-grievance-feedback: {}`
- `services/cmp-028-appeal-review: {}`

All four Wave B `package.json` files declare **no** external dependencies (workspace scripts only). No new package resolutions invented.

## Packages section

`packages:` section of `pnpm-lock.yaml` is **byte-identical** to execution base. Existing package integrity hashes: **0 changes**. Existing snapshot bodies: **0 changes**. Removed existing entries: **0**. Unrelated version upgrades: **0**.

`pnpm install --frozen-lockfile` **PASS**. Warning only: ignored build scripts `@swc/core@1.16.12` (root `onlyBuiltDependencies` read-only).
