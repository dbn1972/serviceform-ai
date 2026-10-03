# Cursor Task 00 - Architecture Verification Only

Do not write product code.

Read `00_READ_FIRST.md`, `ARCHITECTURE-CONSTITUTION.md`, `AGENTS.md`, `specs/build-plan.yaml`, the latest v1.5 architecture and v1.1 building-block specification.

Create `docs/audits/ARCHITECTURE-VERIFICATION-001.md` containing:
1. Architecture summary in your own words.
2. Confirm frozen decisions: PostgreSQL, EKS/Fastify, tenant RLS, OPA/GoRules/Temporal separation, ServiceForm Studio, TenantServiceBinding, external simulation modes.
3. Detect contradictions or missing executable contracts.
4. Classify findings BLOCKER / HIGH / MEDIUM / LOW / INFO.
5. For each blocker/high finding, cite the exact specification section and recommend the smallest correction or ADR.
6. Validate module dependencies in `specs/build-plan.yaml`.
7. Validate that Residence Certificate can be configured without service-specific backend code.
8. Final status: READY_FOR_BOOTSTRAP / READY_WITH_NON_BLOCKING_GAPS / NOT_READY.

Do not silently resolve architecture ambiguity. Do not create code unless explicitly asked after this audit is reviewed.
