# ARCHITECTURE-VERIFICATION-001

| Item | Value |
|---|---|
| Task | `prompts/00_ARCHITECTURE_VERIFICATION.md` (Phase 0 of `CLAUDE-MULTI-AGENT-GUIDE.md` §5) |
| Date | 3 October 2026 |
| Role | Principal Engineering Orchestrator (read-only; no production code written, no package file edited) |
| Repository | `serviceform-ai`, branch `main`, HEAD `28f7955` ("Point references at the new docs layout"), working tree clean before this file, no remote |
| Baseline verified against | AWS Component Functional & Technical Specification **v1.7**, Building Block Engineering Specifications **v1.4**, Tenant Isolation Architecture **v1.0**, package **v2.5**, Claude Multi-Agent Guide **v1.1**, Model Routing Policy **v1.0** |
| Integrity | `sha256sum -c MANIFEST.sha256`: all entries OK |
| Contract lock state | `orchestrator/contracts-lock.yaml`: `contracts: []` (nothing DRAFT/FROZEN yet) |
| Gate / evidence state | No gate evidence recorded; `evidence/` holds only README; `orchestrator/work-queue.yaml` and `agent-registry.yaml` empty |
| **Final status** | **READY_WITH_NON_BLOCKING_GAPS** (see §8) |

Note on versions: `prompts/00` still instructs the reader to use "the latest v1.5 architecture and v1.1 building-block specification". Those files are not in the repository; this audit was executed against the owner's fixed baseline (v1.7 / v1.4 / v1.0) listed in `docs/authoritative/README.md` and `00_READ_FIRST.md`. This is finding H-07.

## 0. Files read

Mandatory read order (guide §3) items 1–20: `00_READ_FIRST.md`, `CLAUDE-MULTI-AGENT-GUIDE.md`, `CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE-CONSTITUTION.md`, `MULTI-AGENT-DEVELOPMENT.md`, `DESIGN-SYSTEM.md`, `SECURITY.md`, `TENANCY.md`, `WORKFLOW.md`, `TESTING.md`, `AI-GOVERNANCE.md`, `MODEL-ROUTING-QUALITY.md`, `specs/model-routing-quality.yaml`, `specs/build-plan.yaml`, `specs/component-map.yaml`, `specs/integration-map.yaml`, `specs/agent-topology.yaml`, `specs/agent-orchestration.yaml`, `orchestrator/contracts-lock.yaml`. Also: `specs/design-system.yaml`, `specs/error-codes.yaml`, `specs/world-class-extensions.yaml`, `orchestrator/*`, `.claude/agents/*` (13), `.claude/settings*.json`, `prompts/00–12`, `ci/*`, `simulators/README.md`, `evidence/README.md`, `contracts/README.md`, `templates/residence-certificate/README.md`, `docs/catalogue/*.csv` (Residence entries).

Authoritative documents, full text extracted and checked: AWS v1.7 (§1–22, CMP-001…061, Appendices), Engineering v1.4 (Parts I–III, CMP-001…061, INT-001…019, §6–20), Tenant Isolation v1.0 (§1–25, Appendices). Component responsibilities and dependencies were parsed programmatically from Engineering v1.4 and cross-checked against `specs/*.yaml`.

---

## 1. Architecture summary (in my own words)

ServiceForm AI is a multi-tenant, metadata-driven platform on which Indian government bodies publish citizen services without writing service-specific code. A service is a published bundle of metadata (service, local offering, form, rules, evidence, fee, workflow, SLA, access policy, credential, notification), authored in ServiceForm Studio, approved maker-checker, and frozen into an immutable **TenantServiceBinding** that each application pins at submission. Generic engines execute that bundle.

Runtime responsibilities are deliberately split. **Aurora PostgreSQL** is the only authoritative transactional store; pooled tenant tables carry `tenant_id` and **FORCE RLS** as the hard tenant wall. **OPA** answers "may this subject do this action on this resource in this tenant/org/jurisdiction/workflow context" and nothing else. **GoRules ZEN** evaluates deterministic eligibility, evidence, fee and routing rules. **Temporal** sequences durable processes but never owns business state: the Application/Case domain commits state plus an outbox event first, and Temporal is signalled afterwards, idempotently. Search, caches, analytics and AI memory are derived and rebuildable. Files go to S3; events go through MSK/Kafka with a transactional outbox.

It is built AWS-first (EKS, Aurora, MSK, OpenSearch, S3, Bedrock behind an AI Gateway) on Node.js/TypeScript/Fastify, Next.js/React and Flutter, with portable contracts (OpenAPI 3.1, AsyncAPI, JSON Schema, OIDC, OTel). Scale is by cells (pool/bridge/silo tenant placement) toward a 10K TPS target. Officers authenticate via Keycloak; citizens via a separate Citizen Identity Service (mobile OTP, DigiLocker verification, later DigiLocker SSO) keyed by an immutable `citizen_id`. **UX4G Design System 3.0** is the mandatory UI baseline. Every external dependency has REAL / SANDBOX / SIMULATED adapters that traverse the same domain path; production fails closed on a SIMULATED critical connector. AI may assist but never makes final statutory decisions.

Delivery is by AI agents in parallel under contract locks: an Opus-routed orchestrator dispatches bounded task envelopes with single-writer paths against FROZEN contracts; independent integration, security, performance and evidence verifiers produce executed evidence; humans approve ADRs, exceptions and certification. The first proof is the Golden Residence Certificate authored entirely in Studio, then a second service (Income Certificate) onboarded mainly by configuration.

---

## 2. Objective-by-objective confirmation

| # | Objective | Result | Basis |
|---|---|---|---|
| 1 | Complete architecture understood | **Confirmed** | §1 above; AWS v1.7 §1–5, §11–13, §20; Eng v1.4 §2–3, §6, §11; TI v1.0 §4–25 |
| 2 | All 61 component responsibilities and dependencies | **Confirmed, with gaps** | All 61 CMPs have responsibilities, non-responsibilities, data, APIs, events and dependencies in Eng v1.4 §4 (CMP-047 lists "all components"). Names in `component-map.yaml` match v1.7 apart from 10 cosmetic suffix differences (L-02). Build-plan placement of 2 components missing and 1 duplicated (H-02). Full table: Appendix A |
| 3 | Frozen architecture decisions | **Confirmed** | Table in §3 |
| 4 | Tenant isolation, FORCE RLS, OPA | **Confirmed** | Constitution #6–7, #23–24; AWS v1.7 SF-005/SF-006, §20.1–20.6, §20.9; TI v1.0 §5, §7–9, §20, §23, §25. One wording softness (L-04) |
| 5 | GoRules and Temporal | **Confirmed** | Constitution #7, #10, #33; AWS v1.7 §1, §3.1, §20.1, §20.7–20.8; Eng v1.4 §11.1 (commit-before-signal); SF-025 (separate Temporal persistence) |
| 6 | TenantServiceBinding and immutable version pinning | **Confirmed, one open semantic** | Constitution #8–9, #35; AWS v1.7 §19.15, §20.11, §21.7; Eng v1.4 §11, INT-002. Open: whether the authorization policy version floats or is pinned for in-flight cases (M-03) |
| 7 | UX4G mandatory baseline | **Confirmed, one internal contradiction** | `DESIGN-SYSTEM.md`, `specs/design-system.yaml`, AWS v1.7 §22, Eng v1.4 §19. CMP-054 in v1.7 still says "MUI may be implementation base" (M-05) |
| 8 | REAL / SANDBOX / SIMULATED connectors | **Confirmed** | Constitution #14, #22; Eng v1.4 §10.1–10.4, INT-013; `simulators/README.md`; routing hard gate 10 |
| 9 | Multi-agent development and contract locking | **Confirmed, with tooling gaps** | Guide §1–17; `MULTI-AGENT-DEVELOPMENT.md`; Eng v1.4 Part III §20.1–20.16; `agent-orchestration.yaml`; lock file present but empty. Gaps M-06, M-07, M-08, H-05 |
| 10 | BLOCKER / HIGH inconsistencies | **0 BLOCKER for bootstrap, 7 HIGH** | §4. H-01 and H-02 must be closed by ADR before any M01 task is dispatched |

---

## 3. Frozen decisions (prompt 00 item 2)

| Decision | Confirmed in | Status |
|---|---|---|
| Aurora PostgreSQL authoritative; no DynamoDB / extra transactional DB without ADR | Constitution #4; AWS v1.7 §1 ("Frozen v1 persistence decision"), SF-003, SF-023; TI v1.0 §8 | Confirmed |
| EKS + Node.js/TypeScript/Fastify backend; Next.js/React web; Flutter mobile | `00_READ_FIRST.md`; AWS v1.7 cover table, §1, §2 | Confirmed |
| Tenant `tenant_id` + FORCE RLS; no BYPASSRLS; server-derived tenant context | Constitution #6; SF-005/006; TI v1.0 §8.1, §23, §25 | Confirmed |
| OPA = authorization; GoRules = deterministic rules; Temporal = orchestration; PostgreSQL = state + RLS (not merged) | Constitution #7; AWS v1.7 §20.1, §20.17 | Confirmed |
| ServiceForm Studio is the supported authoring path; no tenant Rego / tenant Temporal classes | Constitution #1, #30; AWS v1.7 §5, §19, §20 (normative box), §20.17 | Confirmed |
| TenantServiceBinding + immutable published versions + application pinning | Constitution #8–9; AWS v1.7 §19.15, §20.11 | Confirmed |
| Commit-then-signal; transactional outbox; no network calls in DB transactions | Constitution #10–11; Eng v1.4 §11.1; AWS v1.7 §20.14 step 6–7 | Confirmed |
| REAL / SANDBOX / SIMULATED; prod fails closed on SIMULATED critical connector | Constitution #22; Eng v1.4 §10.2 | Confirmed |
| UX4G 3.0 mandatory | Constitution (UX4G section); AWS v1.7 §22 | Confirmed (see M-05) |
| AI never makes final statutory decisions; AI Gateway for all model calls | Constitution #20, #40, #42; SF-011/012; `AI-GOVERNANCE.md` | Confirmed (see H-03 on sequencing) |
| Temporal remains runtime; BPMN is import/export only | Constitution #33; AWS v1.7 §21.3; `WORKFLOW.md` | Confirmed |
| Development sequence is frozen unless an ADR changes it | AWS v1.7 §17 (normative box) | **Conflicts with package plan, see H-01** |

---

## 4. Findings (prompt 00 items 3–5)

Severity meaning used here: **BLOCKER** stops M00 bootstrap; **HIGH** must be resolved (fix or accepted ADR) before the first M01 task is dispatched or before the affected module starts, as stated per finding; **MEDIUM** must be resolved before the named module; **LOW/INFO** housekeeping.

### BLOCKER

None. Nothing found prevents M00 (repository skeleton, CI, contract tooling, local environment), provided the owner confirms H-06.

### HIGH

**H-01 Four incompatible module sequences share the same IDs.**
- AWS v1.7 §17 "Frozen Development Sequence" defines M0–M15 (e.g. M5 Rules, M6 Evidence, M7 Application, M9 Payment, M10 Credential, M11 Notification, M13 DigiLocker, M14 AI) and says it is frozen "unless an accepted ADR changes the sequence".
- Eng v1.4 §7 defines Waves 0–8 (Wave 0: CMP-055/047/048/031; Wave 6 communications/integrations incl. 037/038).
- Eng v1.4 §12 defines M01–M09 with different contents from the package: §12 M01 = CMP-001/002/003/033/034/051/052/053 (Foundation & Tenant Control); §12 M06 = Evidence, Documents & Integration Backbone (012/013/014/032/037/038); §12 M07 = Fees, Payments, Credentials & Communications.
- Eng v1.4 §20.7 and `specs/build-plan.yaml` use a fifth grouping (M01 Foundation = 002/003/030/031/048/052/055; M06 Fees/Payments/Notifications; M07 Credentials).
- Precedence (guide §4) puts AWS v1.7 and Eng v1.4 above `specs/*.yaml`, so a strict agent would override the build plan, but the two authoritative documents disagree with each other and Eng v1.4 disagrees with itself (§12 vs §20.7).
- **Smallest correction:** ADR-0001 (proposed below) declaring `specs/build-plan.yaml` (after H-02/H-03/H-04 fixes) the single executable sequence, superseding AWS v1.7 §17 and Eng v1.4 §7/§12 groupings for scheduling only, with a mapping table. No architecture rule changes.

**H-02 Build plan component ownership is incomplete.** `specs/build-plan.yaml`: CMP-027 Grievance & Feedback and CMP-032 Storage Service are in no module; CMP-052 Versioning & Configuration Registry is in both M01 and M03. Total placements 60 for 61 components. CMP-032 is needed by CMP-013 Upload (M04), CMP-022 Credential (M07), CMP-049 Retention (M08) and INT-006/INT-011, so M04 cannot exit without it. INT-013 is also in two modules (M02, M06). **Correction:** in the ADR-0001 plan, place CMP-032 in M01 (or M04 at the latest), CMP-027 in M05 (as Eng v1.4 §12.5 does), keep CMP-052 in M03 only (or split "registry primitives M01 / Studio publishing M03" explicitly), and give INT-013 one owning module with the other listed as a consumer.

**H-03 Platform backbone and AI Gateway are scheduled after their consumers.** Parsed dependency check (Eng v1.4 dependencies vs build-plan module ancestry) gives 42 forward or missing dependencies. The material ones:
- CMP-038 Event Bus and CMP-037 Integration Hub are in M06, but the M05 hot path needs them (INT-004, INT-005, INT-011 list CMP-038; Constitution #11 outbox), and M02's INT-001/INT-013 need CMP-037/036. CMP-036 API Gateway is also M06.
- CMP-047 Observability is in M08, but CMP-036/037/038 (M06) depend on it and Eng v1.4 §7 puts it in Wave 0.
- CMP-039 AI Gateway is in M08, but four AI components (CMP-010, 014, 040, 043) are in M04. `AI-GOVERNANCE.md` says "All model calls pass through the AI Gateway", and Eng v1.4 §6.1 says core domains must not depend on AI for correctness.
- 10 of 19 INT contracts are scheduled in a module before one or more of their participating components exist (INT-001, 002, 003, 004, 005, 006, 009, 010, 011, 013). Full list in Appendix B.
- **Correction:** in ADR-0001, move minimal CMP-036/037/038/047 slices (envelopes, outbox relay, adapter SPI, OTel baseline) into M01, move CMP-039 before any AI component or move the AI components (010, 040, 043, and the AI part of 014) to after CMP-039; mark the remaining cross-module peers as "consume FROZEN contract + SIMULATED peer" in the task envelope rather than as build-order dependencies.

**H-04 Golden slice is gated on AI and world-class extensions.** `build-plan.yaml` M10 depends on M07, M08 and M09, so Residence certification waits for AI assistants, analytics and CMP-056…061. AWS v1.7 §7 says AI assistance comes "only after deterministic runtime is proven", §17.1 lists the golden flow without AI, and Eng v1.4 §7 requires the golden slice "before Wave 7 is considered production-ready". **Correction:** in ADR-0001, make M10 depend on M05/M06/M07 plus only the M08 components the golden flow uses (035 search, 006/007 discovery, 047 observability), and run M09 after M11 or in parallel, as an extension.

**H-05 Routing YAML is missing two of the policy's twelve hard gates.** `MODEL-ROUTING-QUALITY.md` §4 lists 12 blocking gates; `specs/model-routing-quality.yaml` `hard_gates` lists 10. Missing: gate 9 "authoritative PostgreSQL state commits before dependent Temporal signal" and gate 11 "no AI model alone makes a final adverse statutory decision". Gate 4 is also narrowed from "Critical or High" to `unresolved_critical_security`. An orchestrator driven by the YAML would not block on these. **Correction:** add `commit_before_workflow_signal` and `no_ai_final_adverse_decision` (blocking) and align gate 4 with the policy text. This is a package edit; owner approval needed.

**H-06 The package is silent about the existing codebase.** The owner's GitHub repository (dbn1972/serviceformai, recorded in project notes) is NestJS + TypeORM + React/Vite + MUI with application-level tenant filtering and no OPA, GoRules or Temporal. The package's frozen stack (Fastify, Next.js, UX4G, FORCE RLS, OPA, GoRules, Temporal) and bootstrap prompt 01 assume a greenfield monorepo. Bootstrap is safe only if greenfield is the intent. **Correction:** owner confirms greenfield for this repository, or an ADR (proposed ADR-0004 below) records that the existing code is reference/migration input only. Not inventing architecture: this only asks which of two existing things is the starting point.

**H-07 Prompt 00 and three spec files cite superseded versions.** `prompts/00_ARCHITECTURE_VERIFICATION.md` line 5 says "v1.5 architecture and v1.1 building-block specification"; `specs/component-map.yaml` line 66, `prompts/05` line 3 and `prompts/06` line 3 say Engineering/Building Block v1.3. `docs/authoritative/` contains only v1.7/v1.4/v1.0, so an agent following prompt 00 literally would stop for missing files or load the wrong baseline. **Correction:** update the four version strings to v1.7 / v1.4 (owner approval, package edit).

### MEDIUM

**M-01 Event envelope field naming differs between the authoritative documents.** AWS v1.7 §13.2 uses snake_case `event_id`, `schema_version`, `tenant_id`, `cell_id`; Eng v1.4 Appendix A and TI v1.0 §13 use camelCase `eventId`, `eventVersion`, `tenantId`, `cellId`. The envelope is the first contract every builder consumes. Fix before M01: the Contract Guardian freezes one envelope (AWS v1.7 wins on precedence) and records it in `contracts-lock.yaml`.

**M-02 Application state machine differs.** Eng v1.4 §11.1 introduces `WITHDRAWAL_REQUESTED` and `CANCELLATION_REQUESTED` states; AWS v1.7 §12.1 has only `WITHDRAWN` and `CANCELLED`. Fix before M05: ADR or contract decision on whether the request states are first-class states or workflow tasks.

**M-03 Authorization policy pinning is ambiguous.** AWS v1.7 §20.11 puts `authorization_policy_version_id` in the pinned TenantServiceBinding, Constitution #9 pins "executable dependency versions", but §20.15 says authorization for in-flight cases "uses effective published policy according to governance … behavior must be explicit". Fix before M03/M05: ADR choosing pinned vs effective-latest for authorization (other versions stay pinned).

**M-04 Golden service policy inputs are not supplied.** The catalogue has IND-SOC-002 Residence Certificate with State alias rows, but no pilot tenant/State, legal basis, eligibility rules, evidence list, fee, SLA start anchor or credential template is specified. Constitution and Eng v1.4 §9.5 forbid inferring these. Owner must supply them before M10 R0.

**M-05 UX4G vs MUI contradiction inside v1.7.** CMP-054 "Recommended implementation" says "MUI may be implementation base but public API is owned by ServiceForm"; §22.7 and `DESIGN-SYSTEM.md` prohibit Material UI without an ADR and wrapper. Fix before M03: ADR stating §22.7 governs. Also unverified from here: that UX4G 3.0 ships official React and Flutter component libraries as `specs/design-system.yaml` assumes; the UX4G builder must confirm at M03 start.

**M-06 Validator referenced by CI is missing.** `ci/ARCHITECTURE-GATES.md` names `python scripts/validate_specs.py`; no `scripts/` directory exists, and there is no `.github/workflows/` or `CODEOWNERS` (Eng v1.4 §20.3 requires CODEOWNERS on architecture/contracts/RLS paths). These are M00 deliverables; prompt 01 should create them.

**M-07 Verifier agents cannot write their outputs.** `.claude/agents/serviceform-security-verifier.md`, `-performance-verifier.md` and `-evidence-verifier.md` have tools `Read, Grep, Glob, Bash` (no Edit/Write) while `agent-topology.yaml` gives them write scopes `tests/security/**`, `tests/performance/**`, `evidence/**`. Fix before first verification run: add Write/Edit restricted to those paths, or route their output through the orchestrator.

**M-08 Gate vocabularies differ.** Guide §14 and prompt 10: `GATE_READY / GATE_READY_WITH_DOCUMENTED_LIMITATION / BLOCKED`. Prompt 12: adds `REMEDIATE_ONCE / ESCALATE_TO_OPUS / BLOCKED_CRITICAL_GATE`. Policy §11 AI work record: `GATE_READY|REMEDIATE|BLOCKED|BLOCKED_CRITICAL_GATE`. Fix before first gate: one enum in `specs/agent-orchestration.yaml`.

**M-09 DR region, DPDP Act, Aadhaar and CERT-In handling remain open.** AWS v1.7 §1 DR region "proposed"; §4 RPO/RTO "to be finalized" with baseline RPO ≤ 5 min / RTO ≤ 60 min. None of the three authoritative documents mention DPDP Act 2023 or Aadhaar; CERT-In appears only in `SECURITY.md`. Not needed for M00; needed before CMP-030/061 design (M01/M09) and before G5/G6.

### LOW

- **L-01** `build-plan.yaml` header is `version: '2.3'` inside package v2.5; gates G2 COMPONENT_VERIFIED and G5 PERFORMANCE_RESILIENCE_VERIFIED are never module exit gates (G5 evidence is bundled into M10's G6).
- **L-02** `component-map.yaml` names differ cosmetically from v1.7 for 10 CMPs (e.g. CMP-020 "Service" vs "Engine", CMP-054 "UX4G Design System / Accessibility Layer" vs "Design System / Accessibility Layer"). The map is names only; responsibilities and dependencies live solely in the DOCX.
- **L-03** `specs/error-codes.yaml` lacks `SF-RULE-002` and `SF-RATE-001` from AWS v1.7 §13.3.
- **L-04** AWS v1.7 §1 database row says RLS "where appropriate"; SF-005, TI v1.0 §8.1/§23/§25 make FORCE RLS mandatory for pooled tables. The stricter rule applies; wording only.
- **L-05** `orchestrator/templates/task-envelope.yaml` defaults `model_route: sonnet`, and `agent-topology.yaml` gives `component_builder` a sonnet default, while foundation, case-execution and credential builders route to Opus. The orchestrator must override per role.
- **L-06** CMP-036 API Gateway appears in no Eng v1.4 §7 wave.

### INFO

- **I-01** `.claude/settings.json` uses `teammateMode: in-process`; the guide example uses `auto`. Owner's choice; repository controls remain authoritative either way.
- **I-02** Guide §19 first prompt ends with `READY_TO_DISPATCH / READY_WITH_BLOCKERS / NOT_READY` (planning phase) while prompt 00 ends with this audit's statuses. Different phases; no conflict.
- **I-03** TI v1.0 §15 "task work-queues must be tenant-aware" and AWS v1.7 §20.8 "not one queue per tenant by default" are compatible (tenant context in payload, shared queues by workload class).

---

## 5. Missing executable contracts (prompt 00 item 3)

Expected at Phase 0 and to be produced in M00/M01 by the Contract Guardian, not invented here:
- `contracts/` is empty except README; `contracts-lock.yaml` has no entries.
- Needed before any parallel M01 work: tenant/request context type (TI v1.0 Appendix A), event envelope (M-01), error envelope and catalogue (AWS v1.7 §13.3, L-03), idempotency record (AWS v1.7 §13.4), audit event minimum (AWS v1.7 §14.3), OPA input/output decision contract (AWS v1.7 §20.3), connector adapter SPI with mode field (Eng v1.4 §10), isolation-class declaration schema (TI v1.0 §7).
- Needed before M03/M05: TenantServiceBinding schema (AWS v1.7 §20.11 + §21.7 optional dependencies), application state-machine contract (M-02), workflow DSL node/edge schema (AWS v1.7 §20.7).

---

## 6. Build-plan dependency validation (prompt 00 item 6)

Module graph in `specs/build-plan.yaml` is acyclic: M00 → M01 → {M02, M03} → M04 → M05 → {M06, M08}; M06 → M07; {M05, M07, M08} → M09; {M07, M08, M09} → M10 → M11. Concurrency groups CG-01 (M02‖M03) and CG-02 (M06‖M08) are consistent with it.

Component-level validation fails as described in H-02/H-03/H-04: 2 unowned components, 1 duplicate, 42 forward or unowned dependency edges (many are peer contracts that can be consumed FROZEN + SIMULATED; the ones that cannot are listed in H-03), and 10 INT contracts scheduled before a participant exists. Appendix B lists every edge.

---

## 7. Residence Certificate without service-specific backend code (prompt 00 item 7)

**Architecturally yes.** Every step of the golden flow (Eng v1.4 §11, §15; AWS v1.7 §17.1, §18.2) maps to a generic engine and a Studio-authored artifact:

| Golden step | Generic capability | Studio artifact |
|---|---|---|
| OTP login, profile, claims | CMP-004, 005, 012 | none (platform) |
| Discovery, eligibility pre-check | CMP-001, 006, 007, 008 | service/offering + rule package |
| Form, evidence, upload | CMP-009, 011, 013, 014, 032, 054 | form package (UX4G renderers), evidence package |
| Submit, pin, fee | CMP-015, 020, 021, 052 | TenantServiceBinding, fee package |
| Workflow, tasks, OPA, deficiency, SLA, verification | CMP-016, 017, 018, 019, 029 + OPA | workflow package, access policy (Access Designer), SLA package |
| Decision, signing, credential, QR, DigiLocker, notify | CMP-022, 023, 024, 012, 025 | credential package, notification package |

AWS v1.7 §17.1 explicitly prohibits a Residence-specific service, controller, schema or State branch, and `templates/residence-certificate/` holds only a target-shape README. The catalogue provides canonical IND-SOC-002 with State aliases (Bihar, Haryana, Kerala and others).

Conditions: the plan must deliver CMP-032 (H-02) and the backbone (H-03) before M04/M05, and the statutory content for the chosen State must come from the owner (M-04). Without M-04, an agent would have to invent eligibility, SLA and evidence rules, which the constitution forbids.

---

## 8. Final status

**READY_WITH_NON_BLOCKING_GAPS**

Reasoning: no finding stops M00 (repository skeleton, CI, contract tooling, local environment). The HIGH findings concern module sequencing, gate configuration and version strings, all of which are resolvable during M00 without changing any architecture rule. Conditions attached to this status:

1. Owner confirms greenfield for this repository (H-06) before prompt 01 runs.
2. ADR-0001 (H-01…H-04), now drafted at `docs/adr/ADR-0001-canonical-build-sequence.md` with `specs/build-plan.proposed.yaml`, is accepted before the first M01 task envelope is created; until then the orchestrator must not dispatch M01. See §10 for the re-run.
3. H-05 and H-07 are fixed in the package before the first quality gate and before this prompt is re-run.
4. M-01 and the §5 contracts are FROZEN by the Contract Guardian as part of M00/M01.

## 9. Proposed ADRs (for human approval; nothing has been changed)

| ADR | Title | Resolves | Proposal |
|---|---|---|---|
| ADR-0001 (drafted, `docs/adr/`) | Canonical executable build sequence | H-01, H-02, H-03, H-04, L-01 | `specs/build-plan.yaml` is the single scheduling source; mapping table to AWS v1.7 §17 and Eng v1.4 §7/§12; CMP-032 → M01, CMP-027 → M05, CMP-052 single owner; minimal CMP-036/037/038/047 slices → M01; CMP-039 before AI components; M10 depends only on what the golden flow uses; M09 after M11 or parallel. Supersedes AWS v1.7 §17 ordering only, as that section allows. |
| ADR-0002 | Canonical event envelope | M-01 | Adopt AWS v1.7 §13.2 field set; Eng v1.4 Appendix A and TI v1.0 §13 read as the same fields. |
| ADR-0003 | Withdrawal/cancellation request states | M-02 | Choose first-class `*_REQUESTED` states or workflow tasks over the v1.7 state set. |
| ADR-0004 | Starting point: greenfield vs existing NestJS codebase | H-06 | Record that this repository is greenfield and the existing code is reference/migration input only (or the opposite, with the stack exceptions it implies). |
| ADR-0005 | Authorization policy version for in-flight cases | M-03 | Pinned per TenantServiceBinding vs effective-latest with audit. |
| ADR-0006 | UX4G is the only UI base | M-05 | §22.7 supersedes the CMP-054 MUI note. |

Package corrections not needing an ADR (owner approval only): H-05 routing YAML gates, H-07 version strings, M-07 verifier tool lists, M-08 gate enum, L-02/L-03 spec alignments.

---

## 10. Re-run after drafting ADR-0001 (3 October 2026)

The owner instructed that a legitimate blocker be resolved first. The build-order conflict (H-01…H-04) does not block M00 but does block the first M01 dispatch, so it was treated as the blocker to resolve now. ADR-0001 was drafted as a proposal (`docs/adr/ADR-0001-canonical-build-sequence.md`) with a proposed plan (`specs/build-plan.proposed.yaml`). The Architecture Constitution, `specs/build-plan.yaml` and all other package files are unchanged.

| Check | Current `build-plan.yaml` | Proposed plan |
|---|---|---|
| Unique components placed | 59 of 61 (027, 032 missing) | 61 of 61 |
| Duplicate component / INT owners | CMP-052, INT-013 | none |
| Hard component-dependency violations | 13 | 0 |
| Hard integration violations | 9 | 0 |
| Golden M10 waits on AI assistants or M09 | yes | no |
| Module graph acyclic | yes | yes |

Finding status after re-run:

| Finding | Status |
|---|---|
| H-01 four module sequences | Resolved in proposal (ADR-0001 mapping table); effective on acceptance |
| H-02 ownership gaps | Resolved in proposal |
| H-03 backbone / AI Gateway order | Resolved in proposal |
| H-04 golden gated on AI and M09 | Resolved in proposal |
| H-05 routing YAML gates | Open (package edit, owner approval) |
| H-06 fresh start vs existing NestJS code | Open (owner answer) |
| H-07 version strings | Open (package edit, owner approval) |

Status unchanged: **READY_WITH_NON_BLOCKING_GAPS**. M00 can start once H-06 is answered; M01 dispatch waits for ADR-0001 acceptance.

## Appendix A. 61 components: responsibilities, dependencies and placement

Responsibilities and dependencies are from Engineering v1.4 §4 (CMP-001…061); "dependencies" are the declared dependency/integration partners (several are mutual). Placement columns show the four sequencing sources compared in H-01.

| CMP | Name (Eng v1.4) | Class | Core responsibilities (Eng v1.4, abridged) | Declared dependencies / integration partners | build-plan.yaml | Eng v1.4 §12 | Eng v1.4 §7 wave |
|---|---|---|---|---|---|---|---|
| CMP-001 | Service Catalogue & Registry | Control Plane | Canonical service definitions and categories; Local service offering metadata and provider/jurisdiction bindings; Searchable service descriptors, tags and lifecycle status | 002, 003, 051, 052 | M03 | M01 | W2 |
| CMP-002 | Tenant & Government Organisation Service | Control Plane | Tenant lifecycle; Organisation hierarchy; Office registry | 003, 004, 048, 055 | M01 | M01 | W1 |
| CMP-003 | Jurisdiction Engine | Shared Domain | Jurisdiction types and nodes; Parent/child containment; Jurisdiction-to-office/service bindings | 002, 004, 008, 017 | M01 | M01 | W1 |
| CMP-004 | Identity & Access Service | Shared Security | Officer token validation and claims normalization; Citizen OTP/session lifecycle; Linked identity methods and account recovery | 005, 012, 048 | M02 | M02 | W1 |
| CMP-005 | Citizen Profile Service | Domain Service | Citizen profile fields; Verified-claim provenance; Address/family/occupation profile sections | 004, 007, 012, 030 | M02 | M02 | W1 |
| CMP-006 | Service Discovery Engine | Experience Service | Keyword/faceted search; Service-category browsing; Jurisdiction-aware availability | 001, 003, 035, 053 | M08 | M04 | W7 |
| CMP-007 | Recommendation Engine | Decision Support | Recommendation generation; Reason codes/explanations; Consent-aware feature access | 001, 005, 030, 039 | M08 | M04 | W7 |
| CMP-008 | Eligibility / Rules Engine | Shared Decision Engine | Eligibility evaluation; Evidence rules; Fee/routing rules | 009, 016, 033, 051 | M04 | M03 | W3 |
| CMP-009 | Dynamic Forms Engine | Shared Runtime | JSON Schema validation; UI schema interpretation; Conditional visibility | 008, 011, 050, 053, 054 | M04 | M03 | W3 |
| CMP-010 | AI Form Assistant | AI Capability | Explain questions; Suggest field values from allowed sources; Extract structured data from evidence | 009, 014, 030, 039 | M04 | M04 | W3 |
| CMP-011 | Evidence & Document Requirement Engine | Domain Engine | Evidence requirement resolution; Alternative evidence sets; DigiLocker vs upload options | 008, 012, 013, 018 | M04 | M03 | W3 |
| CMP-012 | DigiLocker Connector | Integration Adapter | OAuth/OIDC adapter; Document picker/listing; Document fetch/metadata verification | 004, 011, 022, 037 | M07 | M06 | W6 |
| CMP-013 | Document Upload Service | Platform Service | Upload session creation; Size/type policy; S3 presigned/direct upload | 014, 032, 048 | M04 | M06 | W3 |
| CMP-014 | Document Intelligence / OCR Service | AI/Extraction Service | OCR; Document classification; Field extraction | 013, 018, 039 | M04 | M06 | W3 |
| CMP-015 | Application / Case Management Service | Core Domain | Draft/application creation; Submission transaction; State machine enforcement | 008, 009, 016, 021, 031 | M05 | M05 | W4 |
| CMP-016 | Workflow Engine | Core Orchestration | Durable sequencing; Timers/waits/retries; Branching based on rule results | 008, 015, 017, 029 | M05 | M05 | W4 |
| CMP-017 | Work Queue & Task Management | Core Domain | Human-task creation; Claim/unclaim/reassign; Queue filtering | 003, 004, 016 | M05 | M05 | W4 |
| CMP-018 | Inspection / Verification Service | Domain Service | Inspection scheduling; Checklist/observation capture; Geo/photo references | 011, 013, 016, 017 | M05 | M05 | W4 |
| CMP-019 | Deficiency / Clarification Service | Domain Service | Deficiency notice; Requested items; Citizen response | 015, 016, 025, 029 | M05 | M05 | W4 |
| CMP-020 | Fee & Calculation Engine | Decision Engine | Fee rule evaluation; Breakdown generation; Waiver/exemption logic | 008, 021, 051 | M06 | M07 | W5 |
| CMP-021 | Payment Service | Integration Domain | Payment intent; Gateway adapter invocation; Webhook verification | 015, 016, 020, 037 | M06 | M07 | W5 |
| CMP-022 | Certificate / Credential Engine | Domain Service | Credential data assembly; Template rendering; Signing/eSign integration | 023, 024, 032, 037 | M07 | M07 | W5 |
| CMP-023 | QR Verification Service | Public Verification | QR token generation; Public verification endpoint; Status/issuer display | 022, 024, 030 | M07 | M07 | W5 |
| CMP-024 | Credential Registry / Revocation Service | Authoritative Registry | Credential status registry; Revocation/suspension; Reissue lineage | 012, 022, 023 | M07 | M07 | W5 |
| CMP-025 | Notification Service | Platform Service | Template rendering; Channel routing; Provider adapter invocation | 037, 038, 053 | M06 | M07 | W6 |
| CMP-026 | Communication / Messaging Service | Domain Experience | Conversation/thread; Message send/read; Attachment references | 004, 013, 015, 031 | M06 | M07 | W6 |
| CMP-027 | Grievance & Feedback Engine | Domain Service | Grievance submission; Category/severity; Routing | 016, 017, 025 | **none** | M05 | W8 |
| CMP-028 | Appeal / Review Engine | Domain Service | Appeal filing; Admissibility metadata; Appeal workflow link | 003, 015, 016, 031 | M05 | M05 | W8 |
| CMP-029 | SLA & Escalation Engine | Shared Control | SLA clock; Working calendar; Pause/resume policy | 016, 017, 019, 025 | M05 | M05 | W4 |
| CMP-030 | Consent & Privacy Service | Cross-Cutting Governance | Consent capture; Purpose binding; Consent withdrawal | 004, 005, 031, 049 | M01 | M02 | W1 |
| CMP-031 | Audit & Evidence Ledger | Cross-Cutting Governance | Actor/action/resource audit; Before/after references where appropriate; Decision reason/provenance | 045, 049 | M01 | M02 | W0 |
| CMP-032 | Storage Service | Platform Abstraction | Object key generation; Encryption policy; Presigned access | 013, 049 | **none** | M06 | W3 |
| CMP-033 | Metadata / Configuration Service | Control Plane | Draft metadata; Schema validation; Config composition | 050, 051, 052 | M03 | M01 | W2 |
| CMP-034 | Master Data Service | Shared Reference | Code sets; Version/effective dates; Bulk import | 003, 009, 053 | M03 | M01 | W2 |
| CMP-035 | Search & Indexing Service | Platform Service | Index pipelines; Tenant-safe query filters; Full-text/facet search | 001, 015, 038 | M08 | M08 | W7 |
| CMP-036 | API Gateway | Edge Platform | Ingress routing; Rate limits; Partner keys/usage plans where applicable | 047, 048 | M06 | M08 | - |
| CMP-037 | Integration Hub / Connector Framework | Platform Integration | Connector registry; Auth/secret handling; Request/response mapping | 038, 047, 048 | M06 | M06 | W6 |
| CMP-038 | Event Bus / Messaging Platform | Platform Backbone | Topic governance; Schema/versioning; Partitioning | 031, 047 | M06 | M06 | W6 |
| CMP-039 | AI Gateway | AI Platform | Provider abstraction; Model routing; Prompt/data redaction | 030, 031, 048 | M08 | M08 | W7 |
| CMP-040 | AI Service Designer Agent | AI Capability | Service draft generation; PDF/DOCX/image extraction orchestration; Field/rule/workflow proposal | 039, 043, 044, 050 | M04 | M03 | W7 |
| CMP-041 | AI Citizen Assistant | AI Capability | Service Q&A; Form assistance; Evidence explanation | 006, 009, 015, 039 | M08 | M04 | W7 |
| CMP-042 | AI Officer Copilot | AI Capability | Case summary; Evidence discrepancy highlight; Draft deficiency/decision note | 017, 031, 039, 048 | M08 | M05 | W7 |
| CMP-043 | AI Validation Agent | AI/Quality Capability | Form reachability checks; Rule/workflow consistency; Evidence mapping | 039, 050, 051 | M04 | M03 | W7 |
| CMP-044 | AI Testing Agent | AI/Quality Capability | Test generation; Edge-case expansion; Fixture generation | 043, 055 | M04 | M03 | W7 |
| CMP-045 | Analytics & MIS Platform | Data Platform | KPI models; Department/tenant dashboards; SLA/service analytics | 030, 038, 049 | M08 | M08 | W8 |
| CMP-046 | Operational Dashboard | Operations Experience | Service health; Queue backlog; SLA breach | 029, 037, 038, 047 | M08 | M08 | W8 |
| CMP-047 | Observability Platform | Platform Operations | OpenTelemetry instrumentation; Metrics/logs/traces; SLO calculation | all components (CloudWatch, Prometheus/Grafana, OTel) | M08 | M08 | W0 |
| CMP-048 | Security Platform | Cross-Cutting Security | OPA policy runtime/control; Secrets/KMS; Workload identity | 004 | M01 | M02 | W0 |
| CMP-049 | Data Retention / Archival Engine | Governance Platform | Retention policy; Archive transitions; Deletion eligibility | 015, 030, 031, 032 | M08 | M08 | W8 |
| CMP-050 | Administration & Service Designer Portal | Product Surface | Service Studio UI; Tenant administration; Role/access design UI | 033, 051, 052, 054 | M03 | M03 | W2 |
| CMP-051 | Maker-Checker / Publishing Engine | Control Plane | Submission for review; Checker approval/rejection; Dependency validation | 033, 043, 052 | M03 | M01 | W2 |
| CMP-052 | Versioning & Configuration Registry | Control Plane | Version IDs; Artifact hashes; Dependency graph | 033, 051 | M01, M03 | M01 | W2 |
| CMP-053 | Localization Service | Shared Experience | Translation resources; Locale fallback; Date/number formatting | 009, 025, 050, 054 | M03 | M01 | W2 |
| CMP-054 | Design System / Accessibility Layer | Shared Experience | Design tokens; Form controls; Accessibility semantics | 009, 050 | M03 | M04 | W2 |
| CMP-055 | Developer Platform | Engineering Platform | Repo templates; CI quality gates; OpenAPI/AsyncAPI pipelines | 044 | M01 | M08 | W0 |
| CMP-056 | Scheduler & Appointment Service | Shared Domain Service | Appointment type and slot-template configuration; Office/resource/role capacity calendars; Book, reschedule, cancel and wait-list operations | 002, 003, 017, 025, 029, 048 | M09 | M09 | M09 ext. |
| CMP-057 | Assisted Service / Omnichannel Service | Citizen & Channel Domain | Assisted-application session lifecycle; Applicant-versus-operator identity separation; Representation/guardian/authorized-agent evidence | 004, 005, 015, 030, 031, 048 | M09 | M09 | M09 ext. |
| CMP-058 | Government Semantic & Data Dictionary Registry | Control Plane / Semantic Governance | Canonical data-element registry; Datatype/format/validation metadata; Privacy/purpose/retention classification defaults | 009, 030, 033, 034, 053 | M09 | M09 | M09 ext. |
| CMP-059 | Migration & Legacy Onboarding Workbench | Engineering / Transformation Platform | Source inventory and profiling; Legacy-to-canonical field/semantic mapping; PDF/form/workflow/config import assistance | 031, 033, 037, 052, 058 | M09 | M09 | M09 ext. |
| CMP-060 | Risk, Fraud & Integrity Service | Decision Support / Integrity | Duplicate-application/document/account signals; Document-tamper and identity inconsistency signals; Submission/officer anomaly detection | 013, 014, 015, 017, 031, 039 | M09 | M09 | M09 ext. |
| CMP-061 | Citizen Privacy & Data Rights Centre | Citizen Trust / Privacy Domain | Citizen-facing data-use/consent dashboard; Consent history and linked-claim provenance; Access/correction/erasure/withdrawal request intake | 004, 017, 025, 030, 031, 049 | M09 | M09 | M09 ext. |

## Appendix B. Build-plan edges that point forward or to an unowned component

Format: module, component, needs, scheduled in.

| Module | Component | Needs | Scheduled in |
|---|---|---|---|
| M01 | CMP-002 | CMP-004 | M02 |
| M01 | CMP-003 | CMP-004 | M02 |
| M01 | CMP-003 | CMP-008 | M04 |
| M01 | CMP-003 | CMP-017 | M05 |
| M01 | CMP-030 | CMP-004 | M02 |
| M01 | CMP-030 | CMP-005 | M02 |
| M01 | CMP-030 | CMP-049 | M08 |
| M01 | CMP-031 | CMP-049 | M08 |
| M01 | CMP-031 | CMP-045 | M08 |
| M01 | CMP-048 | CMP-004 | M02 |
| M01 | CMP-052 | CMP-033 | M03 |
| M01 | CMP-052 | CMP-051 | M03 |
| M01 | CMP-055 | CMP-044 | M04 |
| M02 | CMP-004 | CMP-012 | M07 |
| M02 | CMP-005 | CMP-012 | M07 |
| M02 | CMP-005 | CMP-007 | M08 |
| M03 | CMP-034 | CMP-009 | M04 |
| M03 | CMP-051 | CMP-043 | M04 |
| M03 | CMP-053 | CMP-009 | M04 |
| M03 | CMP-053 | CMP-025 | M06 |
| M03 | CMP-054 | CMP-009 | M04 |
| M04 | CMP-008 | CMP-016 | M05 |
| M04 | CMP-010 | CMP-039 | M08 |
| M04 | CMP-011 | CMP-012 | M07 |
| M04 | CMP-011 | CMP-018 | M05 |
| M04 | CMP-013 | CMP-032 | UNOWNED |
| M04 | CMP-014 | CMP-039 | M08 |
| M04 | CMP-014 | CMP-018 | M05 |
| M04 | CMP-040 | CMP-039 | M08 |
| M04 | CMP-043 | CMP-039 | M08 |
| M05 | CMP-015 | CMP-021 | M06 |
| M05 | CMP-019 | CMP-025 | M06 |
| M05 | CMP-029 | CMP-025 | M06 |
| M06 | CMP-036 | CMP-047 | M08 |
| M06 | CMP-037 | CMP-047 | M08 |
| M06 | CMP-038 | CMP-047 | M08 |
| M07 | CMP-022 | CMP-032 | UNOWNED |
| M08 | CMP-035 | CMP-038 | M06 |
| M08 | CMP-045 | CMP-038 | M06 |
| M08 | CMP-046 | CMP-037 | M06 |
| M08 | CMP-046 | CMP-038 | M06 |
| M08 | CMP-049 | CMP-032 | UNOWNED |

INT contracts scheduled before a participating component exists:

- INT-001 M02 Citizen authentication and profile late: [('CMP-012', ['M07']), ('CMP-025', ['M06']), ('CMP-036', ['M06']), ('CMP-037', ['M06'])] unowned: []
- INT-002 M03 Service design and publication late: [('CMP-016', ['M05']), ('CMP-040', ['M04']), ('CMP-043', ['M04'])] unowned: []
- INT-003 M04 Service discovery to application draft late: [('CMP-006', ['M08']), ('CMP-007', ['M08']), ('CMP-012', ['M07']), ('CMP-015', ['M05'])] unowned: []
- INT-004 M05 Application submission hot path late: [('CMP-038', ['M06'])] unowned: []
- INT-005 M05 Workflow and officer task late: [('CMP-038', ['M06'])] unowned: []
- INT-006 M04 Evidence and verification late: [('CMP-012', ['M07']), ('CMP-016', ['M05']), ('CMP-017', ['M05']), ('CMP-018', ['M05'])] unowned: ['CMP-032']
- INT-009 M05 Deficiency and SLA late: [('CMP-025', ['M06'])] unowned: []
- INT-010 M08 Search, analytics and projections late: [('CMP-038', ['M06'])] unowned: []
- INT-011 M05 Tenant isolation enforcement late: [('CMP-035', ['M08']), ('CMP-038', ['M06'])] unowned: ['CMP-032']
- INT-013 M02 External dependency simulation contract late: [('CMP-021', ['M06']), ('CMP-025', ['M06']), ('CMP-037', ['M06'])] unowned: []
