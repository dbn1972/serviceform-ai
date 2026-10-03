# Getting started (engineering foundation, M00)

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22 LTS (`.nvmrc`) | `engines` enforces >=22.12 <23 |
| pnpm | 10.28.0 | `corepack enable` picks it from `packageManager` |
| Python | 3.11+ | gates: `pip install -r scripts/requirements.txt` |
| Flutter | 3.47.6 stable | mobile app |
| Docker | with Compose v2 | local infrastructure |
| PostgreSQL | 16 | provided by Compose; any disposable 16.x works for `pnpm db:test` |

## Everyday commands

```bash
pnpm install
pnpm format:check && pnpm lint && pnpm typecheck
pnpm test                      # unit/component tests (Vitest)
pnpm contracts:validate        # shared JSON Schemas and examples
pnpm gates                     # architecture gates (Python)
pnpm deps:graph                # dependency rules (dependency-cruiser)
pnpm build                     # API + Next.js shells
pnpm e2e                       # Playwright smoke + axe (after building the web apps)

bash scripts/dev/init-local-env.sh
docker compose -f infra/local/docker-compose.yml --env-file infra/local/.env up -d
export DATABASE_URL=postgres://USER:PASS@127.0.0.1:5432/serviceform   # from infra/local/.env
pnpm db:migrate && pnpm db:test

cd apps/mobile && flutter pub get && flutter analyze && flutter test
```

`pnpm check:bootstrap` runs the whole M00 check suite and writes logs to `evidence/M00/logs/`.

## Where things go

See [REPOSITORY-LAYOUT.md](REPOSITORY-LAYOUT.md). Component code arrives in `services/` from M01,
one directory per CMP, hosted by `apps/api` as Fastify plugins.
