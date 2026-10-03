# Development Workflow

## Work unit
A normal work unit is 1-5 requirement IDs. Large epics must be decomposed before coding.

## Branch/PR requirements
- PR title/body lists requirement IDs.
- PR includes architecture impact, security/tenant impact, migrations, tests, observability and rollback.
- Contract/schema changes appear in the same PR as implementation.
- Breaking changes require an ADR and explicit version/migration plan.

## Preferred implementation shape
Start with a small number of deployable units while preserving domain boundaries in code and contracts. Split services only for scale, security boundary or team ownership.

## Stack baseline
- Backend: TypeScript + Fastify on Node.js.
- Web: React + Next.js.
- Mobile: Flutter.
- System of record: PostgreSQL.
- Cache/ephemeral coordination: Redis.
- Search: OpenSearch.
- Object storage: S3-compatible encrypted storage.
- Durable workflows: platform workflow DSL + Temporal reference runtime.
- Events: Kafka-compatible event backbone + PostgreSQL outbox/inbox.
- Telemetry: OpenTelemetry-compatible traces/metrics/logs.

Exact supported versions are pinned in implementation lockfiles and upgrade policy, not embedded in service definitions.


## Front-end development baseline
Use UX4G Design System 3.0 components, tokens and patterns. Standard React/Flutter controls must come from the governed UX4G wrapper/renderer packages. Do not build feature-local design primitives.


## Multi-agent execution
Use one branch/worktree per agent. A task envelope defines allowed write paths, frozen contracts, tests and evidence. Integration/security/performance verification is independent. See `MULTI-AGENT-DEVELOPMENT.md`.
