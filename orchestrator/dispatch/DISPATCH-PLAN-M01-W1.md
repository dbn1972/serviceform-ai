# Dispatch plan: M01 wave 1 (DISPATCH-PLAN-M01-W1)

| Field | Value |
|---|---|
| Prompt | `prompts/07_MULTI_AGENT_ORCHESTRATOR.md` |
| Orchestrator route | Opus (`claude-opus-5-5`), effort high |
| Date | 3 October 2026 |
| Base commit | `684b443` (M00 accepted by the owner) |
| Build plan used | **`specs/build-plan.proposed.yaml` (ADR-0001, PROPOSED).** See section 2. |
| Builders spawned | **None.** Envelopes are written; no task is claimed. |
| Result | **BLOCKED** (section 3). The plan below is ready to dispatch as written once P-01 to P-05 are closed. |

## 1. What is dependency-ready

M00 is accepted, so M01 is the only module whose module-level dependencies are met. Every later
module depends on M01 directly or transitively (M02 and M03 run in parallel only after M01).

Inside M01, five components have no dependency on another M01 component's code, only on shared
contracts. They form wave 1. The other six wait for wave-1 merges or own single-writer paths.

| Wave | Components | Why |
|---|---|---|
| W1 (this plan) | CMP-002 Tenant & Organisation, CMP-048 Security Platform, CMP-031 Audit Ledger, CMP-038 Event Bus, CMP-037 Integration Hub | Roots of the tenancy, authorization, audit and event chain. They meet only through shared contracts (request context, event envelope, audit event, outbox, connector binding). |
| W2 | CMP-003 Jurisdiction, CMP-030 Consent & Privacy, CMP-032 Storage | Need CMP-002, CMP-031 or CMP-048 merged. |
| W2 | CMP-036 API Gateway, CMP-047 Observability | Own `apps/api` and `packages/observability`. Wiring wave-1 plugins into `apps/api` happens here, so only one task ever writes the host. |
| W2 | CMP-055 Developer Platform | Writes `scripts/gates` and `.github`, which are guardian and delivery-controlled paths. |

## 2. Which build plan this relies on

This plan uses **`specs/build-plan.proposed.yaml`**, not the current `specs/build-plan.yaml`.

- ADR-0001 itself says that while it is PROPOSED, `specs/build-plan.yaml` stays in force **and no
  M01 task may be dispatched**. The current plan leaves CMP-032 unowned, puts CMP-052 in both M01
  and M03, and schedules the event bus (CMP-038), integration hub (CMP-037), API gateway (CMP-036)
  and observability (CMP-047) in M06/M08, after the modules that need them (13 hard component
  and 9 hard integration violations, ARCHITECTURE-VERIFICATION-001).
- Under the current plan, wave 1 would instead be CMP-002, CMP-048, CMP-031, CMP-003 and CMP-030
  (CMP-052 excluded because it is double-owned). That plan would still be BLOCKED by P-02 and P-03,
  and by building tenancy and audit with no outbox or event bus to emit through.
- Neither plan has an exit gate for M11 (gap G-06). This does not affect M01, but ADR-0001 must
  add it before acceptance.

## 3. Result: BLOCKED

Prompt 07 step 2 requires refusing any task whose required contract is not FROZEN. Every wave-1
task needs the shared envelopes, and all eleven are DRAFT. Unaccepted ADRs block the freeze.

| ID | Blocker | Blocks | Who closes it | How |
|---|---|---|---|---|
| P-01 | ADR-0001 build sequence is PROPOSED; M11 has no exit gate | All tasks (ADR text forbids M01 dispatch) | Owner (human approver) | Accept ADR-0001 with an M11 exit gate added; rename `build-plan.proposed.yaml` to `build-plan.yaml`. |
| P-02 | ADR-0002 snake_case envelope is PROPOSED (AWS v1.7 s13.2 vs Eng v1.4 CMP-038 "tenantId, cellId, eventId") | Freezing the event, error, audit, request-context and authz contracts | Owner, after Contract Guardian review | Accept or amend ADR-0002. |
| P-03 | All 11 shared contracts in `orchestrator/contracts-lock.yaml` are DRAFT | All tasks | Contract Guardian (Opus), owner approves | Review, set FROZEN with hashes; `contracts_lock_gate.py` then guards them. |
| P-04 | Two shared contracts that wave 1 needs do not exist: **SF-CON-OUTBOX** (outbox table shape and relay protocol) and **SF-CON-DB-SESSION-CONTEXT** (`app.tenant_id` and related transaction-local settings, today only in `db/test/rls-harness.int.test.ts`) | SF-M01-001..005 all write to the outbox; 001, 002, 003, 005 rely on the tenant session setting | Contract Guardian drafts, owner approves | Draft both under `contracts/shared`, freeze with P-03. Without them, CMP-038 and its four producers would each invent the shape in parallel. |
| P-05 | ADR-0004 greenfield repository is PROPOSED (verification condition 1) | Formal basis for building fresh in this repo | Owner | Accept ADR-0004 (records the owner's 3 Oct instruction). |

Non-blocking for wave 1, tracked:

- **UX4G 3.0 not vendored (G-03).** No wave-1 task has UI. Blocks M03, not M01.
- **CI has never run (G-01); nothing is pushed.** `merge_policy` requires CI checks and a PR. Until
  the owner pushes, a "PR" is a local branch reviewed by the verifiers, and evidence comes from local
  gate runs. The owner should decide whether wave-1 merges wait for the first CI run.
- **Coverage thresholds skip `services/**`.** `vitest.config.ts` only measures `apps/api` and
  `packages/*`. The orchestrator should add `services/*/src/**` before dispatch (one-line change,
  owner review as a delivery control).
- **No runner for service integration tests.** `pnpm db:test` only covers `db/test`. Each envelope
  therefore asks for a per-service `vitest.integration.config.ts`.
- G-10 (query strings in access logs) is fixed in W2 with CMP-036. G-11 (region, DR) is not needed until infrastructure work.

## 4. Summary

| Task | Component | INT | Builder agent | Model / effort | Write scope | Verifiers |
|---|---|---|---|---|---|---|
| SF-M01-001 | CMP-002 Tenant and Government Organisation Service | INT-011 | `serviceform-foundation-builder` | Opus (claude-opus-5-5), high | `services/cmp-002-tenant-organisation/**`<br>`db/migrations/*_cmp-002-*.sql` | security-verifier; evidence-verifier |
| SF-M01-002 | CMP-048 Security Platform | INT-011 | `serviceform-foundation-builder` | Opus (claude-opus-5-5), high | `services/cmp-048-security-platform/**`<br>`packages/security/**`<br>`policy/opa/**`<br>`db/migrations/*_cmp-048-*.sql` | security-verifier; evidence-verifier |
| SF-M01-003 | CMP-031 Audit and Evidence Ledger | INT-011 | `serviceform-foundation-builder` | Opus (claude-opus-5-5), high | `services/cmp-031-audit-ledger/**`<br>`packages/audit-client/**`<br>`db/migrations/*_cmp-031-*.sql` | security-verifier; evidence-verifier |
| SF-M01-004 | CMP-038 Event Bus | INT-011, INT-013 | `serviceform-foundation-builder` | Opus (claude-opus-5-5), high | `services/cmp-038-event-bus/**`<br>`packages/outbox/**`<br>`db/migrations/*_cmp-038-*.sql` | integration-stitcher; evidence-verifier |
| SF-M01-005 | CMP-037 Integration Hub | INT-013 | `serviceform-integration-builder` | Sonnet (claude-sonnet-5-5), high | `services/cmp-037-integration-hub/**`<br>`packages/connector-sdk/**`<br>`simulators/framework/**`<br>`db/migrations/*_cmp-037-*.sql` | integration-stitcher; security-verifier; evidence-verifier |

All five write scopes were checked against each other with `scripts/gates/check_scope.py`: no path is
writable by two tasks, and each task's sample files pass its own envelope. The only shared file is
`pnpm-lock.yaml`, which is regenerated, never edited.

Routing follows `specs/model-routing-quality.yaml`: tenancy, security, audit and the outbox are
high-consequence foundation work, so SF-M01-001..004 run on Opus. The connector SPI and simulator
framework are bounded and contract-driven, so SF-M01-005 runs on Sonnet (`integration_builder`)
with an Opus verifier and the Sonnet-to-Opus escalation rule. Five concurrent coding agents is the
lower end of the 5-8 the topology recommends for a first wave.

## 5. Approval flow per teammate

1. Orchestrator spawns the builder in its worktree in **plan mode** (read-only).
2. Builder submits the plan named in its envelope: impact plan, tables with isolation classes,
   APIs and events mapped to Eng v1.4, negative tests, new dependencies, rollback.
3. For Opus tasks the security verifier writes the tenant-negative and deny tests first
   (MODEL-ROUTING-QUALITY.md s9); for SF-M01-005 the stitcher writes the duplicate-callback and
   simulation-mode tests first.
4. Orchestrator approves or rejects each plan. **No builder writes code until its plan is approved.**
5. Builder implements, runs gates, writes evidence and a handover. It does not merge.
6. Independent verifiers re-run evidence on the exact commit; evidence verifier recommends a gate state.
7. Owner (or authorized merger) merges. Orchestrator then releases wave 2.

## 6. Task detail

### SF-M01-001: Tenant and Government Organisation Service

| Field | Value |
|---|---|
| Task ID | SF-M01-001 |
| Module | M01 Foundation, Tenancy, Jurisdiction, Security and Platform Backbone (proposed plan) |
| Component IDs | CMP-002 |
| Integration contracts | INT-011 |
| Builder agent | `serviceform-foundation-builder` (role `component_builder`) |
| Model route | opus → `claude-opus-5-5` |
| Effort | high |
| Verifiers | serviceform-security-verifier (opus, xhigh); serviceform-evidence-verifier (opus, high) |
| Branch | `agent/M01-cmp-002-tenant-organisation-SF-M01-001` |
| Worktree | `../wt-SF-M01-001` from `684b443` |
| Plan approval | Required before any write. The security verifier defines tenant-negative and deny tests before implementation (MODEL-ROUTING-QUALITY.md s9). |
| Envelope | `orchestrator/tasks/SF-M01-001.yaml` |

**Dependencies**
- M00 accepted (684b443)
- P-01..P-05 resolved
- no runtime dependency on SF-M01-002..005: audit and outbox are reached through the frozen contracts, with contract-validated test doubles

**Frozen contracts required** (all must be FROZEN before claim)
- SF-CON-COMMON
- SF-CON-REQUEST-CONTEXT
- SF-CON-ERROR-RESPONSE
- SF-CON-ERROR-CATALOGUE
- SF-CON-EVENT-ENVELOPE
- SF-CON-IDEMPOTENCY
- SF-CON-AUDIT-EVENT
- SF-CON-ISOLATION-DECLARATION
- SF-CON-DB-SESSION-CONTEXT (to be drafted and frozen, see dispatch plan P-04)
- SF-CON-OUTBOX (to be drafted and frozen, see dispatch plan P-04)

**Allowed write paths**
- `services/cmp-002-tenant-organisation/**`
- `db/migrations/*_cmp-002-*.sql`
- `pnpm-lock.yaml` only through `pnpm install`, never hand-edited; the merger regenerates it on conflict

**Read-only paths:** every path not listed above, explicitly including `contracts/**`, `specs/**`, `docs/**`, `apps/**`, `packages/contracts/**`, `packages/observability/**`, `db/test/**`, the M00 baseline migration, `scripts/gates/**`, `.github/**`, `orchestrator/**` (except its own handover) and the other wave-1 write scopes. Full list in the envelope.

**Acceptance tests**
- Eng v1.4 CMP-002 interfaces: GET /tenants/{id}, GET/POST /organisations, GET /offices, POST /admin/tenant-bindings; responses and errors validate against frozen schemas
- Tables tenant, organisation, organisation_relation, office, tenant_cell_binding declared with sf:isolation; tenant-scoped tables have tenant_id NOT NULL, ENABLE + FORCE RLS and policies on app.tenant_id
- RLS negative matrix as sf_app: wrong tenant read/insert/update/delete returns zero rows or is refused; unset tenant context returns zero rows
- Tenant id taken only from the server-derived request context, never from a client header (test sends a forged header and is refused)
- Platform-operator tenant creation runs a privileged path that writes an audit event (SF-CON-AUDIT-EVENT) and is denied for tenant roles
- TenantCreated, OrganisationChanged, OfficeActivated, TenantIsolationClassChanged written to the outbox in the same transaction as the state change and valid against SF-CON-EVENT-ENVELOPE
- POST /organisations with a repeated Idempotency-Key creates one row and returns the original response
- Organisation hierarchy changes are versioned and effective-dated; past versions are not mutated
- Migration up/down round trip passes
- Common: format, lint, typecheck, unit, service integration suite, `pnpm gates`, `check_scope.py`, dependency graph, gitleaks, semgrep.

**Required evidence**
- evidence/SF-M01-001/rls-negative-matrix.md (table x operation x tenant case, all pass)
- evidence/SF-M01-001/event-schema-validation.log
- Common: `evidence/SF-M01-001/EVIDENCE.md` (commit, resolved model, effort, commands, results), JUnit, coverage, scope and gate logs, `orchestrator/handovers/SF-M01-001.yaml`.

**Hard quality gates** (blocking, never averaged into VTQS)
- frozen_contract_conformance (100%)
- cross_tenant_leakage (zero)
- unresolved_critical_security (zero)
- rls_required_negative_tests (100%)
- VTQS ≥ 90 from executed evidence for GATE_READY.

**Stop conditions**
- geographic containment needed (belongs to CMP-003)
- a cross-schema foreign key or query is needed
- officer permission decisions needed (belongs to CMP-048/OPA)
- Plus the common set: frozen contract change, architecture or statutory ambiguity, tenant/security boundary change, new infrastructure or engine, write outside scope, need for another wave task's unmerged code, any hard-gate failure.

### SF-M01-002: Security Platform: OPA enforcement, secrets/KMS abstraction, privileged access

| Field | Value |
|---|---|
| Task ID | SF-M01-002 |
| Module | M01 Foundation, Tenancy, Jurisdiction, Security and Platform Backbone (proposed plan) |
| Component IDs | CMP-048 |
| Integration contracts | INT-011 |
| Builder agent | `serviceform-foundation-builder` (role `component_builder`) |
| Model route | opus → `claude-opus-5-5` |
| Effort | high |
| Verifiers | serviceform-security-verifier (opus, xhigh); serviceform-evidence-verifier (opus, high) |
| Branch | `agent/M01-cmp-048-security-platform-SF-M01-002` |
| Worktree | `../wt-SF-M01-002` from `684b443` |
| Plan approval | Required before any write. The security verifier defines tenant-negative and deny tests before implementation (MODEL-ROUTING-QUALITY.md s9). |
| Envelope | `orchestrator/tasks/SF-M01-002.yaml` |

**Dependencies**
- M00 accepted (684b443)
- P-01..P-05 resolved
- identity (CMP-004) is M02: the verified principal arrives through SF-CON-REQUEST-CONTEXT; this task does not issue tokens

**Frozen contracts required** (all must be FROZEN before claim)
- SF-CON-COMMON
- SF-CON-REQUEST-CONTEXT
- SF-CON-ERROR-RESPONSE
- SF-CON-ERROR-CATALOGUE
- SF-CON-EVENT-ENVELOPE
- SF-CON-IDEMPOTENCY
- SF-CON-AUDIT-EVENT
- SF-CON-ISOLATION-DECLARATION
- SF-CON-DB-SESSION-CONTEXT (to be drafted and frozen, see dispatch plan P-04)
- SF-CON-OUTBOX (to be drafted and frozen, see dispatch plan P-04)
- SF-CON-AUTHZ-DECISION

**Allowed write paths**
- `services/cmp-048-security-platform/**`
- `packages/security/**`
- `policy/opa/**`
- `db/migrations/*_cmp-048-*.sql`
- `pnpm-lock.yaml` only through `pnpm install`, never hand-edited; the merger regenerates it on conflict

**Read-only paths:** every path not listed above, explicitly including `contracts/**`, `specs/**`, `docs/**`, `apps/**`, `packages/contracts/**`, `packages/observability/**`, `db/test/**`, the M00 baseline migration, `scripts/gates/**`, `.github/**`, `orchestrator/**` (except its own handover) and the other wave-1 write scopes. Full list in the envelope.

**Acceptance tests**
- packages/security exposes a Fastify plugin that builds the request context from a verified principal and an OPA PEP client returning SF-CON-AUTHZ-DECISION
- Deny by default: missing policy, missing context or unknown action is denied
- Fail closed: OPA unavailable or timing out denies privileged actions (fault-injection test)
- OPA bundle under policy/opa with Rego unit tests (opa test) covering role, tenant, jurisdiction and delegation deny cases
- Secrets/KMS adapter interface with a local implementation; no secret value reaches logs (redaction test)
- privileged_access_record and security_policy_metadata tables with isolation classes and RLS where tenant-scoped
- SecurityPolicyPublished and SecurityIncidentDetected events valid against SF-CON-EVENT-ENVELOPE
- Decision latency p99 recorded for the local decision path (evidence, not a gate yet)
- Common: format, lint, typecheck, unit, service integration suite, `pnpm gates`, `check_scope.py`, dependency graph, gitleaks, semgrep.

**Required evidence**
- evidence/SF-M01-002/opa-test-results.txt (opa test -v)
- evidence/SF-M01-002/fail-closed.log
- evidence/SF-M01-002/deny-matrix.md
- Common: `evidence/SF-M01-002/EVIDENCE.md` (commit, resolved model, effort, commands, results), JUnit, coverage, scope and gate logs, `orchestrator/handovers/SF-M01-002.yaml`.

**Hard quality gates** (blocking, never averaged into VTQS)
- frozen_contract_conformance (100%)
- cross_tenant_leakage (zero)
- unresolved_critical_security (zero)
- opa_required_negative_tests (100%)
- rls_required_negative_tests (100%)
- VTQS ≥ 90 from executed evidence for GATE_READY.

**Stop conditions**
- a token issuer or identity store is needed (CMP-004, M02)
- a statutory business rule would be encoded in Rego (belongs to GoRules/CMP-008)
- a policy pinning model is needed beyond AWS v1.7 s20.3 (pinned vs effective-latest ambiguity, verification report)
- Plus the common set: frozen contract change, architecture or statutory ambiguity, tenant/security boundary change, new infrastructure or engine, write outside scope, need for another wave task's unmerged code, any hard-gate failure.

### SF-M01-003: Audit and Evidence Ledger

| Field | Value |
|---|---|
| Task ID | SF-M01-003 |
| Module | M01 Foundation, Tenancy, Jurisdiction, Security and Platform Backbone (proposed plan) |
| Component IDs | CMP-031 |
| Integration contracts | INT-011 |
| Builder agent | `serviceform-foundation-builder` (role `component_builder`) |
| Model route | opus → `claude-opus-5-5` |
| Effort | high |
| Verifiers | serviceform-security-verifier (opus, xhigh); serviceform-evidence-verifier (opus, high) |
| Branch | `agent/M01-cmp-031-audit-ledger-SF-M01-003` |
| Worktree | `../wt-SF-M01-003` from `684b443` |
| Plan approval | Required before any write. The security verifier defines tenant-negative and deny tests before implementation (MODEL-ROUTING-QUALITY.md s9). |
| Envelope | `orchestrator/tasks/SF-M01-003.yaml` |

**Dependencies**
- M00 accepted (684b443)
- P-01..P-05 resolved
- ingests audit events through the frozen outbox/event contracts; no import of SF-M01-004 code

**Frozen contracts required** (all must be FROZEN before claim)
- SF-CON-COMMON
- SF-CON-REQUEST-CONTEXT
- SF-CON-ERROR-RESPONSE
- SF-CON-ERROR-CATALOGUE
- SF-CON-EVENT-ENVELOPE
- SF-CON-IDEMPOTENCY
- SF-CON-AUDIT-EVENT
- SF-CON-ISOLATION-DECLARATION
- SF-CON-DB-SESSION-CONTEXT (to be drafted and frozen, see dispatch plan P-04)
- SF-CON-OUTBOX (to be drafted and frozen, see dispatch plan P-04)

**Allowed write paths**
- `services/cmp-031-audit-ledger/**`
- `packages/audit-client/**`
- `db/migrations/*_cmp-031-*.sql`
- `pnpm-lock.yaml` only through `pnpm install`, never hand-edited; the merger regenerates it on conflict

**Read-only paths:** every path not listed above, explicitly including `contracts/**`, `specs/**`, `docs/**`, `apps/**`, `packages/contracts/**`, `packages/observability/**`, `db/test/**`, the M00 baseline migration, `scripts/gates/**`, `.github/**`, `orchestrator/**` (except its own handover) and the other wave-1 write scopes. Full list in the envelope.

**Acceptance tests**
- POST /internal/audit-events, GET /audit, GET /audit/{resourceType}/{id} per Eng v1.4 CMP-031; records valid against SF-CON-AUDIT-EVENT
- Append-only: UPDATE and DELETE on audit_event are refused for sf_app (test)
- Tamper evidence: per-tenant hash chain; a modified historical row is detected by the verify routine
- Every record carries tenant, cell, actor, trace and classification; wrong-tenant query returns nothing; privileged cross-tenant read is itself audited
- PII guard: fields outside the audit schema allow-list are rejected, not stored
- Duplicate audit event (same event id) stored once
- Audit sink unavailable: producer path follows the documented outbox retry, no lost record in the failure test
- audit_event partitioned by time; migration round trip passes
- Common: format, lint, typecheck, unit, service integration suite, `pnpm gates`, `check_scope.py`, dependency graph, gitleaks, semgrep.

**Required evidence**
- evidence/SF-M01-003/tamper-detection.log
- evidence/SF-M01-003/rls-negative-matrix.md
- Common: `evidence/SF-M01-003/EVIDENCE.md` (commit, resolved model, effort, commands, results), JUnit, coverage, scope and gate logs, `orchestrator/handovers/SF-M01-003.yaml`.

**Hard quality gates** (blocking, never averaged into VTQS)
- frozen_contract_conformance (100%)
- cross_tenant_leakage (zero)
- unresolved_critical_security (zero)
- rls_required_negative_tests (100%)
- VTQS ≥ 90 from executed evidence for GATE_READY.

**Stop conditions**
- a raw PII field would have to be stored
- retention/archival behaviour is needed (CMP-049, M08)
- a WORM/object-lock store decision is needed (infra decision G-11)
- Plus the common set: frozen contract change, architecture or statutory ambiguity, tenant/security boundary change, new infrastructure or engine, write outside scope, need for another wave task's unmerged code, any hard-gate failure.

### SF-M01-004: Event Bus: transactional outbox library, relay, topic registry

| Field | Value |
|---|---|
| Task ID | SF-M01-004 |
| Module | M01 Foundation, Tenancy, Jurisdiction, Security and Platform Backbone (proposed plan) |
| Component IDs | CMP-038 |
| Integration contracts | INT-011, INT-013 |
| Builder agent | `serviceform-foundation-builder` (role `component_builder`) |
| Model route | opus → `claude-opus-5-5` |
| Effort | high |
| Verifiers | serviceform-integration-stitcher (opus, high); serviceform-evidence-verifier (opus, high) |
| Branch | `agent/M01-cmp-038-event-bus-SF-M01-004` |
| Worktree | `../wt-SF-M01-004` from `684b443` |
| Plan approval | Required before any write. The security verifier defines tenant-negative and deny tests before implementation (MODEL-ROUTING-QUALITY.md s9). |
| Envelope | `orchestrator/tasks/SF-M01-004.yaml` |

**Dependencies**
- M00 accepted (684b443)
- P-01..P-05 resolved (the outbox table and relay protocol must be FROZEN as SF-CON-OUTBOX before this starts, because SF-M01-001..003 write to it)

**Frozen contracts required** (all must be FROZEN before claim)
- SF-CON-COMMON
- SF-CON-REQUEST-CONTEXT
- SF-CON-ERROR-RESPONSE
- SF-CON-ERROR-CATALOGUE
- SF-CON-EVENT-ENVELOPE
- SF-CON-IDEMPOTENCY
- SF-CON-AUDIT-EVENT
- SF-CON-ISOLATION-DECLARATION
- SF-CON-DB-SESSION-CONTEXT (to be drafted and frozen, see dispatch plan P-04)
- SF-CON-OUTBOX (to be drafted and frozen, see dispatch plan P-04)

**Allowed write paths**
- `services/cmp-038-event-bus/**`
- `packages/outbox/**`
- `db/migrations/*_cmp-038-*.sql`
- `pnpm-lock.yaml` only through `pnpm install`, never hand-edited; the merger regenerates it on conflict

**Read-only paths:** every path not listed above, explicitly including `contracts/**`, `specs/**`, `docs/**`, `apps/**`, `packages/contracts/**`, `packages/observability/**`, `db/test/**`, the M00 baseline migration, `scripts/gates/**`, `.github/**`, `orchestrator/**` (except its own handover) and the other wave-1 write scopes. Full list in the envelope.

**Acceptance tests**
- packages/outbox writes an event row in the caller's transaction using the frozen SF-CON-OUTBOX shape; rollback leaves no event (test)
- Relay publishes to Kafka (local compose broker) after commit; at-least-once with event_id de-duplication on the consumer side
- Every published event validates against SF-CON-EVENT-ENVELOPE; an invalid event goes to a DLQ, not the topic
- Topic registry and schema metadata with version checks; an incompatible schema version fails explicitly
- Partition key preserves per-aggregate ordering (test with interleaved aggregates)
- Relay never reads business tables, only outbox tables per the frozen contract
- Consumer checkpoint metadata and lag metric exposed through packages/observability
- Broker down: relay backs off, no event lost, ordering preserved after recovery (fault test)
- Common: format, lint, typecheck, unit, service integration suite, `pnpm gates`, `check_scope.py`, dependency graph, gitleaks, semgrep.

**Required evidence**
- evidence/SF-M01-004/outbox-atomicity.log
- evidence/SF-M01-004/broker-outage.log
- evidence/SF-M01-004/ordering.log
- Common: `evidence/SF-M01-004/EVIDENCE.md` (commit, resolved model, effort, commands, results), JUnit, coverage, scope and gate logs, `orchestrator/handovers/SF-M01-004.yaml`.

**Hard quality gates** (blocking, never averaged into VTQS)
- frozen_contract_conformance (100%)
- cross_tenant_leakage (zero)
- unresolved_critical_security (zero)
- lost_committed_applications (zero lost events in failure tests; proxy for the M05 gate)
- VTQS ≥ 90 from executed evidence for GATE_READY.

**Stop conditions**
- the relay would need cross-component SQL beyond the frozen outbox contract
- SQS vs MSK selection per event class is needed (architecture decision)
- large binary payloads would go on events
- Plus the common set: frozen contract change, architecture or statutory ambiguity, tenant/security boundary change, new infrastructure or engine, write outside scope, need for another wave task's unmerged code, any hard-gate failure.

### SF-M01-005: Integration Hub: connector SPI, binding registry, simulation framework

| Field | Value |
|---|---|
| Task ID | SF-M01-005 |
| Module | M01 Foundation, Tenancy, Jurisdiction, Security and Platform Backbone (proposed plan) |
| Component IDs | CMP-037 |
| Integration contracts | INT-013 |
| Builder agent | `serviceform-integration-builder` (role `component_builder`) |
| Model route | sonnet → `claude-sonnet-5-5` |
| Effort | high |
| Verifiers | serviceform-integration-stitcher (opus, high); serviceform-security-verifier (opus, high) for credential handling; serviceform-evidence-verifier (opus, high) |
| Branch | `agent/M01-cmp-037-integration-hub-SF-M01-005` |
| Worktree | `../wt-SF-M01-005` from `684b443` |
| Plan approval | Required before any write. The verifier defines duplicate-callback and simulation-mode tests before implementation. |
| Envelope | `orchestrator/tasks/SF-M01-005.yaml` |

**Dependencies**
- M00 accepted (684b443)
- P-01..P-05 resolved
- events emitted through the frozen outbox contract; no import of SF-M01-004 code

**Frozen contracts required** (all must be FROZEN before claim)
- SF-CON-COMMON
- SF-CON-REQUEST-CONTEXT
- SF-CON-ERROR-RESPONSE
- SF-CON-ERROR-CATALOGUE
- SF-CON-EVENT-ENVELOPE
- SF-CON-IDEMPOTENCY
- SF-CON-AUDIT-EVENT
- SF-CON-ISOLATION-DECLARATION
- SF-CON-DB-SESSION-CONTEXT (to be drafted and frozen, see dispatch plan P-04)
- SF-CON-OUTBOX (to be drafted and frozen, see dispatch plan P-04)
- SF-CON-CONNECTOR-BINDING
- SF-CON-SIMULATION-MARKER

**Allowed write paths**
- `services/cmp-037-integration-hub/**`
- `packages/connector-sdk/**`
- `simulators/framework/**`
- `db/migrations/*_cmp-037-*.sql`
- `pnpm-lock.yaml` only through `pnpm install`, never hand-edited; the merger regenerates it on conflict

**Read-only paths:** every path not listed above, explicitly including `contracts/**`, `specs/**`, `docs/**`, `apps/**`, `packages/contracts/**`, `packages/observability/**`, `db/test/**`, the M00 baseline migration, `scripts/gates/**`, `.github/**`, `orchestrator/**` (except its own handover) and the other wave-1 write scopes. Full list in the envelope.

**Acceptance tests**
- Connector SPI in packages/connector-sdk: invoke, webhook verify, health; modes REAL | SANDBOX | SIMULATED from SF-CON-CONNECTOR-BINDING
- Production profile refuses to start when a critical connector binding is SIMULATED (fail closed test)
- Simulated responses carry SF-CON-SIMULATION-MARKER and a test_run_id
- connector_definition, connector_binding (tenant/service scoped, RLS), connector_transaction tables; wrong-tenant binding lookup returns nothing
- Credentials are referenced by secret handle only; no secret in DB rows, logs or responses
- Duplicate webhook callback (same provider reference) produces one connector_transaction and one event
- Provider timeout triggers retry with backoff then circuit-open; ConnectorInvocationFailed emitted
- No outbound call inside an open DB transaction (test asserts transaction state at call time)
- A reference echo simulator in simulators/framework exercises the full path; no provider-specific simulator yet
- Common: format, lint, typecheck, unit, service integration suite, `pnpm gates`, `check_scope.py`, dependency graph, gitleaks, semgrep.

**Required evidence**
- evidence/SF-M01-005/simulation-mode-matrix.md
- evidence/SF-M01-005/duplicate-callback.log
- Common: `evidence/SF-M01-005/EVIDENCE.md` (commit, resolved model, effort, commands, results), JUnit, coverage, scope and gate logs, `orchestrator/handovers/SF-M01-005.yaml`.

**Hard quality gates** (blocking, never averaged into VTQS)
- frozen_contract_conformance (100%)
- cross_tenant_leakage (zero)
- unresolved_critical_security (zero)
- production_simulated_critical_connector (zero)
- rls_required_negative_tests (100%)
- VTQS ≥ 90 from executed evidence for GATE_READY.

**Stop conditions**
- a provider-specific connector (payment, DigiLocker, OTP, eSign) is needed (later modules)
- secrets backend selection is needed beyond the CMP-048 adapter interface
- Sonnet route: second failed verification or VTQS < 85 escalates to Opus
- Plus the common set: frozen contract change, architecture or statutory ambiguity, tenant/security boundary change, new infrastructure or engine, write outside scope, need for another wave task's unmerged code, any hard-gate failure.

## 7. Next action

Close P-01 to P-05 (owner acceptance of ADR-0001 with an M11 gate, ADR-0002 and ADR-0004; Contract
Guardian drafts SF-CON-OUTBOX and SF-CON-DB-SESSION-CONTEXT and freezes all shared contracts).
The orchestrator then re-checks the lock file, sets these envelopes to READY, and dispatches.

BLOCKED
