# pnpm-lock.yaml REM-002 summary (SF-M05-REM-002)

Compared to authorized execution base `c0d25b32114779ddb4cc23e4e62a25f9d1365192`.

## Policy

`pnpm-workspace.yaml` `minimumReleaseAge: 10080`, `trustPolicy: no-downgrade`, `blockExoticSubdeps: true` unchanged.
`.npmrc` unchanged. No `minimumReleaseAge=0`. No ignore/bypass flags. No lockfile recreation from scratch. No broad `pnpm update`.
Naive `pnpm install --lockfile-only` was **not** used (would re-resolve existing packages against minimumReleaseAge).
Importer links admitted by copying existing workspace `link:` pattern only.

## Importer section (`apps/api` only)

Added seven `workspace:*` → `link:../../services/...` entries under `importers.apps/api.dependencies`:
- `@serviceform/cmp-015-application-case`
- `@serviceform/cmp-017-work-queue-tasks`
- `@serviceform/cmp-018-inspection-verification`
- `@serviceform/cmp-019-deficiency`
- `@serviceform/cmp-027-grievance-feedback`
- `@serviceform/cmp-028-appeal-review`
- `@serviceform/cmp-029-sla-escalation`

No CMP-016. No re-add / duplicate CMP-036.
Importer added lines: 21. Importer removed lines: 0.

## Packages section

`packages:` section **byte-identical** to execution base: `True`.
sha256 prefix: `48585d83122fec0c` (unchanged).
Existing package integrity hashes: **0 changes**. Unrelated version upgrades: **0**.

## Snapshots section

`snapshots:` section **byte-identical** to execution base: `True`.
sha256 prefix: `b8cab0423a1bae9a` (unchanged).

## Frozen install

`pnpm install --frozen-lockfile` **PASS**.
