# ServiceForm AI Multi-Agent Development Operating Model

## Purpose
Use multiple Cursor, Claude Code, Copilot or other coding agents concurrently without architecture drift, contract drift or unsafe merges.

## Core rule
Parallelize implementation, not architecture. Shared architecture and contracts are frozen before independent agents work against them.

## Roles
- **AI Engineering Orchestrator**: dependency-aware task assignment, worktree/branch allocation, path locks, status and evidence orchestration.
- **Architecture & Contract Guardian**: Architecture Constitution, ADRs, shared OpenAPI/AsyncAPI/JSON Schema/event contracts and compatibility review.
- **Component Builder Agents**: bounded CMP implementation only inside assigned paths.
- **UX4G Experience Agent**: design-system foundation, renderer registry, Storybook/Figma/a11y/visual evidence.
- **Platform/Integration Builder**: provider adapters, generated SDKs, shared integration runtime.
- **Integration & Stitching Agent**: independent INT/E2E execution; no production-code patching to force green tests.
- **Security/Tenant Isolation Agent**: RLS/OPA/IDOR/secret/PII/security verification.
- **Performance/Resilience Agent**: load/soak/chaos/recovery evidence.
- **Verification/Evidence Agent**: traceability/evidence completeness and recommended gate state.
- **Authorized Human Approver**: architecture exceptions, ADRs, production promotion and certification.

## Single-writer ownership
Every task specifies `allowed_write_paths`. One agent owns a protected path at a time. Architecture and contracts require explicit guardian ownership. Generated clients/types are regenerated from contracts and are not hand-edited.

## Contract lifecycle
`DRAFT -> REVIEW -> FROZEN -> CHANGING -> SUPERSEDED/DEPRECATED`.

A FROZEN contract may be consumed but not changed inside a feature branch. Required changes use a Contract Change Request with compatibility, affected consumers, migration and rollout strategy.

## Git model
Each agent uses a dedicated branch and preferably a dedicated worktree:
`agent/<module>-<component>-<task-id>`.
Only protected CI/authorized merger writes to main/release branches.

## Task state
`PLANNED -> READY -> CLAIMED -> IMPLEMENTING -> PR_OPEN -> VERIFYING -> INTEGRATION -> GATE_READY -> MERGED`.
Any state may move to `BLOCKED`; never weaken tests/architecture to escape a blocker.

## Stitching
Use OpenAPI, AsyncAPI, JSON Schema, event schemas, generated SDK/types, consumer-driven contract tests and ephemeral integration environments. Do not copy source code between components or read/write another component's database.

## Parallelization
- M00 serial.
- M01 controlled parallel streams.
- M02 and M03 can run in parallel after M01.
- M04 supports high component parallelism after contracts freeze.
- M05 is a tightly coordinated Case Execution pod.
- M06 and M08 can run in parallel after M05; M07 follows M06.
- M09 uses separate bounded extension agents after prerequisites.
- M10 is integrated Golden Residence certification; M11 proves metadata reuse.

Start with ~5-8 concurrent coding agents. Scale toward ~10-15 only after contract locks, CI, integration environments and ownership controls are stable.

## Required sequence
1. Orchestrator creates READY tasks from `specs/build-plan.yaml` and `specs/agent-orchestration.yaml`.
2. Contract Guardian freezes required contracts.
3. Orchestrator creates branch/worktree + task envelope.
4. Worker implements only allowed scope and opens PR with evidence.
5. Integration Agent runs relevant INT/E2E contracts.
6. Security/Performance Agents run required independent verification.
7. Verification Agent checks evidence and recommends gate state.
8. Human/authorized governance approves merge/gate/certification.
9. Orchestrator releases dependent tasks.
