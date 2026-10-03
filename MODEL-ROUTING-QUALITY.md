# ServiceForm AI - Claude Model Routing & 90%+ Quality Assurance Policy

**Version:** 1.0  
**Applies to:** ServiceForm AI Architecture v1.7, Building Block Engineering Specification v1.4, Claude Multi-Agent Guide v1.1, Autonomous AI Development Package v2.5  
**Purpose:** Select the right Claude model for each engineering role and convert AI output into verified software quality through deterministic gates, independent verification and escalation.

## 1. Quality principle

The target is **>=90% verified first-pass task acceptance**, not a claim that any model is intrinsically 90% accurate. Production correctness is established by executed evidence.

Critical controls are not averaged into a score. They are hard gates and must pass 100% where applicable.

## 2. Default model-routing strategy

Use **Claude Opus 5.5** for open-ended architectural judgment, critical state/security domains, cross-component integration and independent verification. Use **Claude Sonnet 5.5** for bounded implementation, UI, tests, simulators and high-throughput engineering tasks after architecture/contracts are frozen.

| Agent / role | Default model | Effort guidance | Why |
|---|---|---|---|
| Engineering lead / orchestrator | Opus 5.5 | High | Dependency planning, task decomposition, routing, conflict resolution |
| Architecture & contract guardian | Opus 5.5 | High / Xhigh | Architecture, ADR and breaking-contract judgment |
| Foundation builder | Opus 5.5 | High | Tenant, identity, RLS, audit and platform foundations are high consequence |
| Service Studio builder | Sonnet 5.5 | Medium / High | Bounded product implementation after contracts are frozen |
| Forms / rules / evidence builder | Sonnet 5.5 | Medium / High | Structured implementation with deterministic tests |
| Case execution builder | Opus 5.5 | High | Authoritative state, Temporal signalling, tasks, SLA and case integrity |
| Integration / connector builder | Sonnet 5.5 | Medium / High | Adapter contracts and simulators are bounded and testable |
| Credential builder | Opus 5.5 | High | Signing, issuance, revocation and duplicate-side-effect risk |
| UX4G builder | Sonnet 5.5 | Medium / High | Strong implementation/design task with deterministic visual/a11y gates |
| AI platform builder | Sonnet 5.5 | High | Bounded AI gateway/eval implementation; governance still reviewed by Opus |
| Integration & stitching verifier | Opus 5.5 | High | Cross-system reasoning and failure-path analysis |
| Security & tenant-isolation verifier | Opus 5.5 | High / Xhigh | Independent security judgment and attack-path analysis |
| Performance & resilience verifier | Sonnet 5.5 | High | Test execution/analysis is structured; escalate ambiguous systemic findings |
| Evidence / gate verifier | Opus 5.5 | High | Independent acceptance decision from immutable evidence |

If a configured Claude environment exposes symbolic aliases rather than exact release names, map `opus` to the approved Opus 5.5 deployment and `sonnet` to the approved Sonnet 5.5 deployment. Record the resolved model identifier in every AI work record.

## 3. Effort policy

- **Medium:** routine bounded implementation, refactoring, fixtures, straightforward tests.
- **High:** component implementation with state/security/integration impact, architecture planning, integration verification, complex debugging.
- **Xhigh / maximum available reasoning:** architecture exceptions, security/tenant-isolation investigation, major incident/root-cause work, breaking-contract review, difficult migration decisions.
- Do not use maximum effort blindly. A larger effort setting does not replace better task boundaries, contracts or tests.

## 4. Hard production gates - 100% required

Where applicable, a task/module/release cannot be gate-ready unless all relevant hard gates pass:

1. Zero demonstrated cross-tenant data leakage.
2. 100% required PostgreSQL RLS negative tests pass for tenant-owned pooled tables.
3. 100% required OPA deny/role/jurisdiction/delegation tests pass.
4. Zero unresolved Critical or High security findings in release scope unless an authorized exception explicitly permits a specific High with compensating controls and expiry; Critical is never waivable for production.
5. Zero lost committed applications in required failure/chaos scenarios.
6. Zero duplicate financial side effects under duplicate/reordered payment callbacks.
7. Zero duplicate credential issuance/revocation side effects for tested duplicate events/callbacks.
8. 100% frozen API/event/schema contract conformance for required integration tests.
9. Authoritative PostgreSQL state commits before dependent Temporal signal/event side effects where specified.
10. Production critical connectors are REAL and fail closed if configured SIMULATED.
11. No AI model alone makes a final adverse statutory decision.
12. Required Golden E2E scenarios pass for the exact release candidate.

A weighted score cannot compensate for a failed hard gate.

## 5. First-pass quality score

For non-blocked tasks calculate a **Verified Task Quality Score (VTQS)** from executed evidence. Suggested default weights:

- Requirements traceability and acceptance criteria: 20%
- Functional/unit/component behavior: 20%
- Contract/API/event/schema conformance: 15%
- Tenant/security/privacy controls: 20%
- Integration and failure/idempotency behavior: 10%
- Code quality, static analysis and maintainability: 5%
- Observability/audit/evidence completeness: 5%
- UX4G/accessibility/visual regression where UI applies: 5%

For non-UI tasks, redistribute the 5% UX weight proportionally across requirements, contracts and test/evidence dimensions. Scores must be derived from executed artifacts for the exact commit; model self-assessment is not evidence.

## 6. Decision thresholds

- **>=90 and all hard gates pass:** `GATE_READY` recommendation.
- **85-89.99 and hard gates pass:** one bounded remediation cycle is allowed, followed by independent re-verification.
- **70-84.99:** task is not gate-ready; route remediation or reimplementation to Opus 5.5 and require a new independent verification run.
- **<70:** `BLOCKED`; reassess task scope, contracts and architecture before more coding.
- **Any hard-gate failure:** `BLOCKED_CRITICAL_GATE` regardless of numeric score.

## 7. Escalation and retry policy

1. Sonnet worker fails first verification -> same worker may perform one narrowly scoped remediation if no hard gate/architecture issue exists.
2. Second failure, score <85, systemic integration failure, or ambiguous root cause -> escalate implementation/review to Opus 5.5.
3. Architecture, tenancy/security, statutory ambiguity, or frozen-contract conflict -> stop coding and route to Architecture & Contract Guardian; create ADR/Contract Change/Security Exception as applicable.
4. A hard-gate failure must be independently reproduced/verified after remediation; the original builder cannot close it by assertion.
5. Two unsuccessful Opus remediation attempts -> mandatory human architecture/engineering review before additional autonomous attempts.
6. Model changes do not reset evidence. The same tests and acceptance criteria remain authoritative.

## 8. Independent verification rule

The builder's conversation/context must not be the sole verifier. Prefer a fresh verifier context with only:

- task envelope and acceptance criteria
- authoritative CMP/INT excerpts
- frozen contracts
- code diff / commit
- executed test/security/performance artifacts
- known exceptions/ADRs

The verifier should attempt to falsify correctness, not explain why the builder is probably right.

## 9. Test-before-code for critical paths

For tenancy, authorization, authoritative case transitions, payment, credential issuance, workflow migration, retention/privacy rights and security-sensitive connectors:

1. Architecture/verification role defines acceptance and negative tests first.
2. Builder implements against those tests.
3. Independent verifier executes/reproduces evidence.
4. CI gate binds results to commit/image digest.

Generated-but-unexecuted tests count as zero evidence.

## 10. Model routing triggers

Automatically route or escalate to Opus when a task includes any of:

- Architecture Constitution or ADR interpretation
- new database / queue / major managed service
- RLS/OPA/identity/session changes
- cross-tenant or jurisdiction semantics
- authoritative Application/Case state transitions
- Temporal ordering with authoritative state
- payment reconciliation or money movement semantics
- certificate signing, revocation or legal credential state
- breaking OpenAPI/AsyncAPI/schema change
- workflow migration of in-flight cases
- high-severity security finding
- multi-component failure whose root cause is not localized

Sonnet remains the default for well-scoped work after these decisions are frozen.

## 11. Required AI work record

Every material AI task records:

```yaml
ai_work_record:
  task_id: SF-AI-...
  builder_model: claude-sonnet-5-5
  builder_effort: high
  verifier_model: claude-opus-5-5
  verifier_effort: high
  base_commit: <sha>
  result_commit: <sha>
  requirement_ids: []
  component_ids: []
  integration_ids: []
  contract_versions: []
  test_run_ids: []
  security_run_ids: []
  vtqs: 0
  hard_gates: {}
  result: GATE_READY|REMEDIATE|BLOCKED|BLOCKED_CRITICAL_GATE
```

## 12. Release-level quality objectives

- >=90% verified first-pass acceptance across AI implementation tasks over a rolling release window.
- 100% mandatory component/module gate execution.
- 100% required critical security/tenant/financial/credential integrity gates pass.
- >=95% non-critical extended regression pass, unless a stricter module target applies.
- 100% Golden Residence Certificate release-candidate E2E scenarios pass.
- Second-service reuse proof demonstrates ordinary onboarding primarily through metadata/configuration.

Do not optimize the KPI by making tasks artificially tiny or reducing test scope. Track rework rate, escaped defects, integration-failure rate and human-review rejection rate alongside first-pass acceptance.

## 13. Recalibration

Model routing is a policy, not a permanent benchmark claim. Re-run the ServiceForm internal eval suite when:

- Anthropic releases a new model or major model revision;
- prompts/agent definitions materially change;
- the codebase architecture changes;
- observed first-pass acceptance drops below target;
- cost per accepted task changes materially.

Promote a new model into a role only after it meets or exceeds the current role baseline on representative ServiceForm tasks and all hard gates.

## 14. Official source notes

Current routing rationale was aligned in October 2026 with Anthropic's published positioning of Opus 5.5 for complex judgment and Sonnet 5.5 as a faster/lower-cost complement for well-scoped work, along with Anthropic guidance to build task-specific evals and use orchestration such as Opus planning with Sonnet execution.

- https://www.anthropic.com/claude-opus-5-5
- https://www.anthropic.com/claude-sonnet-5-5
- https://www.anthropic.com/webinars/building-with-the-claude-5-5-family-choosing-the-right-model-and-getting-more-from-every-token
