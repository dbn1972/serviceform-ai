# Database migrations

Tool: [node-pg-migrate](https://salsita.github.io/node-pg-migrate/) with plain SQL files in
`migrations/`. Bookkeeping table: `sf_platform.sf_schema_migrations`. Target: PostgreSQL 16
(Aurora PostgreSQL in AWS; `postgres:16` locally and in CI).

```bash
export DATABASE_URL=postgres://...      # supplied per environment, never committed
pnpm db:migrate                         # apply all pending migrations
pnpm db:migrate:down                    # roll back the last migration
pnpm --filter @serviceform/db migrate:create <name>   # new SQL migration file
pnpm db:test                            # migration round trip + RLS harness self-test
```

## Rules enforced by `scripts/gates/migration_lint.py` (CI gate `migration-lint`)

Each file has a `-- Up Migration` and a `-- Down Migration` section.

Every `CREATE TABLE` is declared first with an isolation class (Constitution #24, TI v1.0 s7):

```sql
-- sf:isolation <schema>.<table> <GLOBAL|TENANT_SCOPED|JURISDICTION_SCOPED|CITIZEN_PRIVATE|PLATFORM_OPERATIONAL> owner=CMP-0NN
```

`TENANT_SCOPED` and `JURISDICTION_SCOPED` tables must, in the same file, have
`tenant_id uuid NOT NULL`, `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY` and at
least one `CREATE POLICY` on the table (TI v1.0 s8, s8.1).

Refused in the up section: `BYPASSRLS` grants, `DISABLE ROW LEVEL SECURITY`,
`NO FORCE ROW LEVEL SECURITY`. `DROP TABLE`, `DROP COLUMN` and `TRUNCATE` need
`-- sf:allow-destructive ADR-NNNN` on the line above.

Components own their schemas; no component reads or writes another component's tables
(Constitution #23).
