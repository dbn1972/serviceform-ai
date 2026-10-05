# pnpm-lock.yaml stitch summary (SF-M04-STITCH-B)

Compared to `origin/main` `922509ee78892029a27268078f2dfdaef2f52cce`: **+36 / −0** importer lines (unified-diff tooling may show −1/+N due to identical-block alignment). **packages:** and **snapshots:** sections byte-unchanged. No existing package integrity hashes changed. No unrelated version moves. No new third-party resolutions.

## Importers added

- `services/cmp-009-dynamic-forms` — `@fastify/rate-limit@11.2.0`, `@serviceform/contracts` workspace, `fastify@5.12.5`, `pg@8.23.1`, `@types/pg@8.23.1`
- `services/cmp-014-document-intelligence` — `@serviceform/contracts` workspace, `fastify@5.12.5`, `pg@8.23.1`, `@types/pg@8.23.1`

Pins reuse canonical resolutions already present on main (same as CMP-011 / CMP-013 patterns). No `pnpm install --lockfile-only` refresh was required; importers were admitted by copying existing resolution entries only.

## Controls

`pnpm-workspace.yaml` `minimumReleaseAge: 10080`, `trustPolicy: no-downgrade`, `blockExoticSubdeps: true` unchanged. Root `onlyBuiltDependencies` unchanged. No `minimumReleaseAgeExclude`. `.npmrc` unchanged. Frozen-lockfile CI not weakened.

`pnpm install --frozen-lockfile` **PASS**.
