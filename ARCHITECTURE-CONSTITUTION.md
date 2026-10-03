# ServiceForm AI Architecture Constitution

These rules are MUST-level unless superseded by an approved ADR.

1. Services are configuration, not bespoke applications. A normal service must be onboarded through metadata: service + offering + form + rules + evidence + fee + workflow + SLA + access + credential + notifications.
2. Government organization hierarchy and geographic jurisdiction hierarchy are separate versioned models.
3. No state, district, municipality, panchayat, service name or named officer may be hard-coded into domain logic.
4. Aurora PostgreSQL is the authoritative v1 datastore. Do not add DynamoDB or another transactional database without an approved ADR.
5. Binary files are stored in S3, not PostgreSQL.
6. Every tenant-owned pooled row carries `tenant_id` and uses PostgreSQL FORCE RLS. Client-supplied tenant IDs are never authoritative.
7. OPA decides whether an actor may perform an action. PostgreSQL RLS enforces the hard tenant data boundary. GoRules executes deterministic business/statutory rules. Temporal sequences durable process. These responsibilities must not be merged.
8. Published service/form/rule/workflow/evidence/fee/SLA/access/credential/notification versions are immutable.
9. Every submitted application pins the exact published TenantServiceBinding and executable dependency versions.
10. Application/case state is authoritative in the Application/Case domain. Temporal must not advance an authoritative state change before the domain commit succeeds.
11. Material state changes use a short PostgreSQL transaction and transactional outbox. Never call DigiLocker, payment, eSign, SMS, email or department APIs inside an open DB transaction.
12. Every external command/callback/event consumer is idempotent and retry-safe.
13. Search, caches, analytics and AI memory are derived/non-authoritative and must be rebuildable.
14. Payment occurs only after durable application creation. Payment simulator/sandbox must exercise the same Payment Service and callback/state-machine path as real providers.
15. Evidence has separate technical acceptance state and business verification state.
16. SLA definitions explicitly specify start anchor, business calendar, pause/resume rules, completion anchor and breach/escalation behavior.
17. Withdrawal/cancellation after submission is service-policy driven and may require an authorized workflow; do not assume universal availability.
18. Credential issuance explicitly drives `APPROVED -> SIGNING_PENDING -> ISSUED -> CLOSED`. Notification/DigiLocker delivery failures do not undo an already issued credential.
19. Human workflow assignments target role + organization/office + jurisdiction + service scope, not named employees.
20. AI may assist, explain, extract, draft, generate metadata, test and review. AI must not independently make final statutory approval/rejection/penalty decisions.
21. No full PII, documents, credentials, tokens or secrets in logs, prompts or telemetry.
22. External dependencies support REAL / SANDBOX / SIMULATED adapters. Production deployment fails if a critical connector is SIMULATED.
23. No component may read/write another component's authoritative tables as an integration mechanism, even if initially sharing one Aurora cluster.
24. Every new schema/table declares isolation class: GLOBAL, TENANT_SCOPED, JURISDICTION_SCOPED, CITIZEN_PRIVATE or PLATFORM_OPERATIONAL.
25. Every API/event/schema change is backward compatible or explicitly versioned with a migration plan.
26. Every component has unit, contract, integration, tenant-negative/security and failure-path tests appropriate to its risk.
27. Runtime verification requires executed evidence. Generated tests, code compilation or agent assertions are not verification.
28. Cursor, Copilot, Claude Code or another AI agent cannot self-certify a component/module/release.
29. Architecture changes, new infrastructure, ambiguous statutory rules, tenant-boundary changes, security weakening or breaking contracts require an ADR before implementation.
30. The Residence Certificate Golden Vertical Slice must be authored through ServiceForm Studio and run end to end without service-specific backend code.
31. The second service must prove reuse: if Income Certificate or another service requires bespoke backend code, first identify the smallest reusable platform capability missing.
32. Production release requires tenant isolation, security, accessibility, migration, backup/restore, observability, rollback, performance and resilience gates.
33. Temporal remains the durable workflow runtime. BPMN 2.0 is an import/export interoperability profile over the canonical ServiceForm Workflow Model, not a second runtime source of truth.
34. Publishable service configuration must be exportable/promotable as a signed, content-addressed `.sfpackage`; environment secrets and provider credentials are external references.
35. In-flight workflow/config migration is explicit, simulated, maker-checker approved and evidence-backed. Never silently repoint active cases to a new version.
36. Assisted-service channels record `applied_by` and `applied_for` separately with representation basis and consent; operators never impersonate citizens.
37. Scheduling/appointment/inspection calendars are reusable platform metadata, not service-specific code.
38. Common government fields should bind to canonical semantic element IDs; tenant extensions are namespaced and versioned.
39. Legacy migration requires mapping version, dry-run, exception list and reconciliation evidence before cutover certification.
40. Risk/fraud/integrity signals are advisory by default. No adverse statutory outcome may rely solely on an opaque AI/ML score.
41. Privacy-rights fulfilment is orchestrated through owning components; the privacy centre never directly mutates another component's authoritative tables.
42. Production AI capabilities pin model, prompt, toolset and evaluation versions, with safety/privacy/quality/cost/latency evidence and monitored fallback.


## UX4G Experience Constitution
- UX4G Design System 3.0 is mandatory for all first-party product surfaces.
- JSON Forms remains metadata/runtime foundation; UI widgets render through UX4G-backed React/Flutter renderers.
- Tenant themes are constrained token overlays and must pass contrast/accessibility checks.
- Custom UI is created only as a central ServiceForm UX4G extension with Figma/Storybook/accessibility/visual-regression evidence.
- Introducing another visual design system requires ADR and explicit UX4G conformance.
