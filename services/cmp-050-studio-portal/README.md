# CMP-050 Administration and Service Designer Portal

Metadata-driven Studio and tenant-admin UX for INT-002 (validate → maker-checker → publication). The publication engine remains CMP-051; version pins remain CMP-052; metadata store remains CMP-033.

## Surfaces

- `apps/web-studio` — Service Design Studio (`service_studio`)
- `apps/web-admin` — Tenant administration (`tenant_admin` / `platform_ops`)

This directory is the portal kernel: session, INT-011 header refusal, allowlisted HTTP client, maker-checker **UX** guards, metadata kind field catalog. It is not a Fastify plugin and owns no PostgreSQL (host mount is SF-M03-008). Workspace `package.json` is deferred so this builder does not mutate `pnpm-lock.yaml`.

Web apps talk HTTP only (`.dependency-cruiser.cjs`); they do not import this package.

## Non-goals

- `apps/api/**` edits
- Frozen shared contracts
- Named-service backend
- CERTIFIED claim
