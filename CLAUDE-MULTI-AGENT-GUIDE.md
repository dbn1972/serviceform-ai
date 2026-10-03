# ServiceForm AI — Claude Code Multi-Agent Read → Plan → Execute Guide

**Version:** 1.1  
**Applies to:** ServiceForm AI architecture v1.7, Building Block Engineering Specification v1.4, Tenant Isolation v1.0, Autonomous AI Development Package v2.5  
**Purpose:** Give Claude Code one deterministic operating procedure for reading the repository, planning the build, coordinating multiple agents, implementing components in parallel, integrating them, verifying evidence and stopping at human approval gates.

## 1. Non-negotiable operating rule

Claude is not asked to “build the whole platform” in one pass. Claude acts as an engineering lead that repeatedly executes a controlled loop:

**READ → VERIFY ARCHITECTURE → PLAN → FREEZE CONTRACTS → DISPATCH → BUILD → TEST → INTEGRATE → VERIFY → GATE → CONTINUE**

Parallelize implementation, not architecture. No worker may silently change the Architecture Constitution, tenant/security model, database strategy, frozen API/event/schema contracts, statutory rules, or certification requirements.

## 2. Claude Code execution modes

### Mode A — Claude Agent Teams
Use when the installed Claude Code version supports Agent Teams and the feature has been explicitly enabled. Agent Teams use a lead session, separate teammate sessions, a shared task list, dependency tracking and direct teammate communication. They are currently an experimental Claude Code feature, so ServiceForm repository controls remain the source of truth even when Claude’s internal task list is used.

Enable only after review:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "teammateMode": "auto"
}
```

### Mode B — Independent Claude sessions + Git worktrees
Use when Agent Teams are unavailable, unstable, intentionally disabled, or when maximum repository isolation is preferred. The orchestrator creates task envelopes, branches and worktrees. Each Claude session opens only its assigned worktree. The same contracts, write scopes and gates apply.

**Both modes use the same ServiceForm build plan, task envelopes, contract locks, tests and certification evidence.**

## 3. Mandatory read order for the lead/orchestrator

The lead must read these in order before writing product code:

1. `00_READ_FIRST.md`
2. `CLAUDE-MULTI-AGENT-GUIDE.md`
3. `CLAUDE.md`
4. `AGENTS.md`
5. `ARCHITECTURE-CONSTITUTION.md`
6. `MULTI-AGENT-DEVELOPMENT.md`
7. `DESIGN-SYSTEM.md`
8. `SECURITY.md`
9. `TENANCY.md`
10. `WORKFLOW.md`
11. `TESTING.md`
12. `AI-GOVERNANCE.md`
13. `MODEL-ROUTING-QUALITY.md`
14. `specs/model-routing-quality.yaml`
15. `specs/build-plan.yaml`
16. `specs/component-map.yaml`
17. `specs/integration-map.yaml`
18. `specs/agent-topology.yaml`
19. `specs/agent-orchestration.yaml`
20. `orchestrator/contracts-lock.yaml`
21. Current gate/evidence state
22. Only then: the relevant sections of the authoritative DOCX specifications for the module being planned.

Do **not** load every 200-page specification into every worker. The lead extracts the relevant CMP/INT requirements and places them in the task envelope. Workers read the envelope plus only the specific source sections required for their component.

## 4. Source-of-truth precedence

When instructions disagree, apply this precedence:

1. Approved Architecture Constitution / approved ADR
2. AWS Architecture v1.7
3. Building Block Engineering Specification v1.4
4. Tenant Isolation Architecture v1.0
5. Frozen OpenAPI / AsyncAPI / JSON Schema / policy / workflow contracts
6. `specs/*.yaml`
7. Repository agent instructions (`AGENTS.md`, `CLAUDE.md`, design/security/testing files)
8. Task envelope
9. Agent-generated plan

An agent-generated plan may never override a higher-precedence source.

## 5. Phase 0 — Repository and architecture verification

The lead begins read-only.

Required actions:

- Inspect Git status and baseline commit.
- Confirm expected versions are present.
- Run/perform `prompts/00_ARCHITECTURE_VERIFICATION.md`.
- Verify architecture invariants: Aurora PostgreSQL authoritative state; tenant `FORCE RLS`; OPA authorization; GoRules deterministic business rules; Temporal orchestration; transactional outbox; immutable published metadata; TenantServiceBinding; UX4G design system; REAL/SANDBOX/SIMULATED adapters; no service-specific backend implementation for ordinary services.
- Verify current contract lock state and current module gate state.
- Produce `docs/audits/ARCHITECTURE-VERIFICATION-<n>.md`.

Allowed result: `READY_FOR_BOOTSTRAP`, `READY_WITH_NON_BLOCKING_GAPS`, or `NOT_READY`.

No production feature coding is allowed when result is `NOT_READY`.

## 6. Phase 1 — Build the dependency-aware master plan

Read `specs/build-plan.yaml`. Convert the plan into a dependency graph. Do not schedule a task unless all mandatory predecessor gates are satisfied.

Canonical module flow:

- M00 — architecture verification, repository bootstrap, CI, contract registry, orchestrator
- M01 — foundation: tenant, organisation, jurisdiction, security, audit, developer platform
- M02 — identity and citizen profile
- M03 — service catalogue, ServiceForm Studio, UX4G foundation, publishing/versioning
- M04 — forms, rules, evidence, upload, OCR, semantic metadata
- M05 — application/case, Temporal workflow, work queue, deficiency, SLA, verification
- M06 — payment, notification, external connectors and simulators
- M07 — credential, signing, QR, revocation, DigiLocker publication
- M08 — discovery, recommendation, AI, analytics/operations
- M09 — appointments, assisted service, semantic registry, migration, risk/integrity, privacy rights and world-class extensions
- M10 — Golden Residence Certificate end-to-end certification
- M11 — second-service reuse proof, normally Income Certificate, primarily by metadata/configuration

The lead should schedule 5–8 concurrent builders initially, increasing only after contract and integration stability are demonstrated.

## 7. Phase 2 — Contract freeze before parallel work

Parallel work begins only after shared seams are explicit.

For every candidate task, determine:

- OpenAPI operations
- AsyncAPI/domain events
- JSON Schemas
- error codes
- identity/authorization inputs
- tenant/jurisdiction fields
- idempotency semantics
- state transitions
- database ownership
- UX4G component contract where UI is involved
- performance/SLO expectations

Required contract lifecycle:

`DRAFT → REVIEW → FROZEN → CHANGING → SUPERSEDED/DEPRECATED`

A worker may consume a `FROZEN` contract but may not edit it. If implementation reveals a required change, the worker stops and raises a Contract Change Request with affected producers/consumers, compatibility impact, migration path and tests.

## 8. Phase 3 — Create task envelopes

Every worker gets a task envelope based on `orchestrator/templates/task-envelope.yaml`.

A valid envelope includes:

- task ID
- module and CMP IDs
- relevant INT IDs
- agent role/type
- dependency status
- branch/worktree
- allowed write paths
- read-only paths
- frozen contract IDs/versions
- exact acceptance criteria
- required tests
- required evidence
- stop conditions
- handover destination

**Single-writer rule:** no two active workers receive overlapping authoritative write paths unless the orchestrator explicitly serializes them.

## 9. Phase 4 — Choose agent/team roles

Recommended Claude teammate/subagent roles:

- `serviceform-architecture-guardian`
- `serviceform-foundation-builder`
- `serviceform-studio-builder`
- `serviceform-forms-rules-builder`
- `serviceform-case-execution-builder`
- `serviceform-integration-builder`
- `serviceform-credential-builder`
- `serviceform-ux4g-builder`
- `serviceform-ai-platform-builder`
- `serviceform-integration-stitcher`
- `serviceform-security-verifier`
- `serviceform-performance-verifier`
- `serviceform-evidence-verifier`

Project definitions live under `.claude/agents/`. Builder roles should normally use worktree isolation. Reviewer/verifier roles should use read-heavy/restricted tools and should not patch production code merely to make a test green.

## 10. Phase 5 — Require plan approval before implementation

For risky or cross-domain tasks, the lead requires a read-only plan before granting implementation permission.

The worker plan must contain:

1. Requirements/CMP/INT being implemented.
2. Files expected to change.
3. Frozen contracts consumed.
4. Database objects/migrations.
5. API/events produced/consumed.
6. Tenant/RLS/OPA impact.
7. State-machine/workflow impact.
8. UX4G components/patterns if UI is involved.
9. Test plan.
10. Failure/idempotency/retry behavior.
11. Observability/audit/privacy impact.
12. Explicit statement that no architecture change is required — or an ADR request if one is required.

Reject the plan if it proposes cross-component SQL, arbitrary tenant JavaScript, ad-hoc UI design outside UX4G, statutory decisions by AI, synchronous external calls inside authoritative DB transactions, unpinned published configuration, or direct changes to frozen contracts.

## 11. Phase 6 — Worker execution loop

After plan approval, a worker performs:

1. Read task envelope and relevant source sections.
2. Confirm branch/worktree and clean status.
3. Add/update tests and contracts before or alongside implementation.
4. Implement only inside allowed paths.
5. Run formatter/lint/typecheck.
6. Run unit tests.
7. Run component/contract tests.
8. Run tenant-negative/security tests required by the envelope.
9. Use SIMULATED/SANDBOX external adapters where specified; never bypass domain state machines.
10. Capture evidence IDs, logs and traces.
11. Produce handover summary.
12. Open PR / mark `PR_OPEN`.
13. Stop. The worker does not merge or self-certify.

## 12. Phase 7 — Integration and stitching

The integration/stitching agent validates seams using contracts and running components. It does not “fix integration” by modifying another component’s production code without a new bounded task.

Required checks include:

- producer/consumer schema compatibility
- generated SDK/type compatibility
- event version compatibility
- idempotency and duplicate delivery
- retries/timeouts/circuit breakers
- authoritative DB commit before Temporal signalling where applicable
- payment callback/reconciliation semantics
- RLS/OPA/tenant/jurisdiction propagation
- UX4G consistency across composed journeys
- external provider REAL/SANDBOX/SIMULATED behavior
- observability/correlation IDs

Integration failures become new tasks assigned to the owning component. Do not weaken the contract test.

## 13. Phase 8 — Independent verification agents

### Security & tenant-isolation verifier
Must test at minimum:

- wrong-tenant row access
- IDOR
- RLS bypass attempts
- OPA deny paths
- role/jurisdiction/delegation mismatches
- secret/PII leakage
- unsafe file access
- auth/session abuse

### Performance & resilience verifier
Runs required load/soak/chaos scenarios only when the relevant environment and module gate require them. Evidence must identify workload mix, environment, build/container digest and measured results.

### Evidence verifier
Checks that test reports correspond to the actual commit/artifacts. AI-generated tests that were not executed do not count as verification evidence.

## 14. Phase 9 — Gate decision and human approval

Agents may recommend:

- `GATE_READY`
- `GATE_READY_WITH_DOCUMENTED_LIMITATION`
- `BLOCKED`

Agents may not independently declare a production release certified. Human/authorized governance approves architecture exceptions, ADRs, release promotion and internal engineering certification.

## 15. Mandatory stop conditions

Any agent must stop and escalate if the task requires:

- changing an Architecture Constitution rule
- new transactional database/major infrastructure platform
- cross-tenant behavior or tenant-context change
- weakening RLS/OPA/security controls
- interpreting ambiguous legislation/policy
- a breaking frozen contract
- direct access to another component’s authoritative tables
- service-specific backend implementation that should be metadata-driven
- ungoverned JavaScript/code in tenant-authored forms/workflows
- AI making a final adverse statutory decision
- production use of SIMULATED critical connectors
- an unapproved workflow migration of in-flight cases
- an undocumented UX4G exception

The correct output is an ADR/Contract Change/Security Exception request, not an invented workaround.

## 16. Claude Agent Teams operating guidance

When using Agent Teams:

- The main session is the lead/orchestrator.
- Explicitly request teammates for independent work only.
- Require plan approval for high-risk teammates.
- Prefer project-defined `.claude/agents/` types.
- Keep teammate tasks large enough to justify a separate context but small enough to finish independently.
- Avoid assigning two teammates to the same files.
- Use dependency-linked tasks; blocked tasks remain pending.
- Use task-completion/idle hooks as deterministic quality gates where available.
- The ServiceForm task envelope and contract lock remain authoritative even if Claude’s shared task list disagrees.
- Do not rely on ephemeral team state as the only project record; persist task/evidence state in the repository.

## 17. Fallback worktree operating guidance

If Agent Teams are not used:

1. Lead creates `agent/<module>-<component>-<task-id>` branch.
2. Lead creates a dedicated Git worktree.
3. Launch one Claude Code session from that worktree.
4. Paste/reference the worker task envelope.
5. Worker implements and commits there.
6. Integration agent consumes the PR/branch, not loose uncommitted files.
7. Remove the worktree only after merge or task cancellation.

## 18. Golden end-to-end proof

Do not consider the platform architecture validated merely because all components compile.

The first integrated proof is the Golden Residence Certificate:

Citizen authentication → discovery → eligibility pre-check → draft → UX4G form → evidence → authoritative submission → optional payment → received → Temporal process → work queue → OPA authorization → scrutiny/deficiency/verification → decision commit → signing → credential → QR → DigiLocker/notification → closure.

The service must be authored through metadata/Studio, not a bespoke `ResidenceCertificateService` implementation.

Then onboard Income Certificate primarily through metadata. If ordinary onboarding requires a new bespoke backend, first determine whether the missing behavior is a reusable platform capability.

## 19. First prompt to give Claude Code

```text
You are the ServiceForm AI Engineering Lead.

Read CLAUDE-MULTI-AGENT-GUIDE.md first, then follow its mandatory read order. Treat the Architecture Constitution and frozen contracts as authoritative.

Do not write product code yet.

Perform Phase 0 repository/architecture verification. Then build a dependency-aware execution plan from specs/build-plan.yaml, current gate status and orchestrator/contracts-lock.yaml.

Propose no more than five initial parallel implementation tasks. For each task show: task ID, module/CMP/INT scope, dependencies, frozen contracts, allowed write paths, branch/worktree, agent type, required tests/evidence and stop conditions.

If Claude Agent Teams are enabled, propose the exact teammate types to spawn, but do not spawn or start implementation until the plan is approved. If Agent Teams are unavailable, propose the equivalent independent-worktree execution plan.

Finish with one of: READY_TO_DISPATCH, READY_WITH_BLOCKERS, or NOT_READY.
```

## 20. Prompt after the plan is approved

```text
Execute the approved ServiceForm AI multi-agent dispatch plan.

Use the project-defined .claude/agents roles and require plan approval for any worker touching security boundaries, tenancy, database migrations, application state, workflow, payment, credentials or shared contracts.

Do not allow overlapping write scopes. Do not allow workers to modify FROZEN contracts. Persist task envelopes, work status, handovers and evidence in the repository.

When workers finish, run the independent integration/stitching and verification phases. Do not merge or self-certify a blocked task. Stop at the required human approval gate and provide a concise evidence-backed status report.
```

## 21. What “done” means

A component is not done because an agent says the code looks correct. It is done only when the required gate has executable evidence for the exact commit/artifacts, including applicable contract, tenant/security, integration and failure-path tests.

A module is not done until its component dependencies and INT contracts pass.

The platform is not release-certified until the authorized release gate approves the exact version, build digests, SBOM, connector-mode inventory, evidence manifest and exceptions.

## 22. Official Claude Code capability references

Operational guidance in this document aligns with current Claude Code documentation as of October 2026:

- Subagents: https://code.claude.com/docs/en/sub-agents
- Agent Teams: https://code.claude.com/docs/en/agent-teams
- Worktrees: https://code.claude.com/docs/en/worktrees
- Hooks: https://code.claude.com/docs/en/hooks
- Project memory / CLAUDE.md: https://code.claude.com/docs/en/memory

Claude Agent Teams are currently described by Anthropic as experimental; repository-level ServiceForm controls must therefore remain sufficient to operate without them.


## 23. Model routing and >=90% verified quality objective

Before dispatch, the lead must read `MODEL-ROUTING-QUALITY.md` and `specs/model-routing-quality.yaml`.

The target is **>=90% verified first-pass task acceptance across a release window**. This is an engineering KPI, not a guarantee that a language model is intrinsically 90% accurate.

Default routing:

- Opus 5.5: engineering lead/orchestrator, architecture guardian, foundation/critical-state work, case execution, credential integrity, integration stitching, security verification and evidence/gate verification.
- Sonnet 5.5: bounded Studio/forms/rules/evidence work, integrations/adapters/simulators, UX4G implementation, AI platform implementation and structured performance execution.

The orchestrator records model and effort in every task envelope/AI work record. A Sonnet task that fails verification twice, scores below 85, or reveals a systemic/ambiguous root cause escalates to Opus. Architecture/security/contract ambiguity stops immediately and routes to the guardian.

Numeric scores never override critical gates. Required tenant/RLS/OPA tests, frozen-contract conformance, committed-state integrity, payment/credential duplicate-safety, Golden E2E scenarios and applicable critical security controls must pass 100% for their scope. Any blocking hard-gate failure results in `BLOCKED_CRITICAL_GATE` regardless of weighted score.

Use `prompts/12_MODEL_ROUTING_QUALITY_GATE.md` to produce the formal task quality/gate recommendation from executed evidence.
