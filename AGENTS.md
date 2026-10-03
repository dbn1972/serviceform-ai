# ServiceForm AI - Agent Instructions

## Mission
Build ServiceForm AI as a metadata-driven, multi-tenant, government-grade service platform exactly from approved architecture, component contracts, integration contracts and ADRs.

## Required reading before every implementation task
1. `00_READ_FIRST.md`
2. `ARCHITECTURE-CONSTITUTION.md`
3. `specs/build-plan.yaml`
4. Relevant component(s) in `specs/component-map.yaml`
5. Relevant integration contract(s) in `specs/integration-map.yaml`
6. Relevant architecture/specification sections in `docs/architecture/`
7. Existing code/tests/migrations and accepted ADRs
8. Applicable path-scoped `.cursor/rules/*.mdc`

## Mandatory task loop
1. Identify module, CMP IDs, INT IDs and requirement IDs.
2. Produce an impact plan: domain, data, APIs/events, tenancy/authz, migration, tests, observability, rollback.
3. If architecture/statutory meaning is ambiguous, STOP and create/propose an ADR. Do not invent policy.
4. Update or create OpenAPI/AsyncAPI/JSON Schema/event contracts before or with code.
5. Add tests before or alongside state-machine/security-sensitive implementation.
6. Implement the smallest generic reusable capability. Never add named-service/state/tenant branching when metadata can express it.
7. Run format/lint/typecheck/unit/contract/component integration/tenant-negative/security tests.
8. Run relevant INT integration tests using REAL/SANDBOX/SIMULATED connectors according to environment.
9. Record evidence in `evidence/` with commit SHA and run identifiers.
10. Self-review against Architecture Constitution and update traceability.
11. Do not claim CERTIFIED. Only report evidence and recommended gate status for human/CI approval.

## Absolute prohibitions
- No final statutory eligibility/approval/rejection decision by an LLM.
- No bypass of RLS, OPA, audit, maker-checker, consent/purpose, retention or security checks.
- No service-specific backend implementation for a normal configurable service.
- No direct cross-component SQL.
- No network calls inside authoritative DB transactions.
- No hard-coded tenant/jurisdiction/service/official names in domain logic.
- No mutation of published versions.
- No PII/secrets/tokens in logs/prompts/test fixtures.
- No disabling tests/security/lint to make CI pass.
- No SIMULATED critical connector in production.
- No self-certification.

## Development order
Follow `specs/build-plan.yaml`. Do not jump ahead unless dependencies are complete and documented.

## Golden proof
Residence Certificate must be created via ServiceForm Studio metadata and pass the Golden E2E certification. Then onboard a second service largely through configuration to prove platform reuse.


## UX4G design-system baseline
All first-party UI follows UX4G Design System 3.0. Read `DESIGN-SYSTEM.md` and `specs/design-system.yaml` before UI work. Reuse UX4G React/Flutter/Web Component patterns and tokens before custom controls. JSON Forms is schema/runtime only; use UX4G-backed renderers. Tenant branding is token overlay only. Do not introduce a second visual design system or ad-hoc design values without ADR.


## Multi-agent development
When multiple AI agents work concurrently, `MULTI-AGENT-DEVELOPMENT.md`, `specs/agent-topology.yaml` and `specs/agent-orchestration.yaml` are normative. The Orchestrator assigns bounded task envelopes and non-overlapping write paths. Shared contracts must be FROZEN before independent builders start. Use dedicated branches/worktrees. Builder agents never self-certify; integration/security/performance/evidence roles remain independent.


## Model routing / quality
All AI agents follow `MODEL-ROUTING-QUALITY.md`. Record actual model/effort, do not treat self-assessment as evidence, and never use a weighted score to override a failed blocking gate.
