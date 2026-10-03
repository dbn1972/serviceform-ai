# ServiceForm AI - Read This First

This repository package is the executable engineering companion to the ServiceForm AI architecture.

## Normative source order
1. `ARCHITECTURE-CONSTITUTION.md` - immutable engineering rules unless superseded by approved ADR.
2. `AGENTS.md` - how every AI coding agent must work.
3. `specs/build-plan.yaml` - implementation order and gate sequencing.
4. Relevant `docs/architecture/*` section for the module/component being implemented.
5. Relevant `specs/component-map.yaml` and `specs/integration-map.yaml` entries.
6. Existing code, migrations, tests and accepted ADRs.

## Authoritative documents
- `ServiceForm_AI_Component_Functional_Technical_Specification_AWS_v1.7.docx` - current end-to-end architecture, Studio, tenancy, OPA/Temporal integration and runtime model.
- `ServiceForm_AI_Building_Block_Engineering_Specifications_v1.4.docx` - all 61 logical components, integration contracts and Design -> Develop -> Verify -> Certify gates.
- `ServiceForm_AI_Tenant_Isolation_Architecture_v1.0.docx` - tenant isolation and FORCE RLS specification.

The older Source-of-Truth v2.0 and AI-Buildable Master Specification remain useful background references, but v1.7/v1.4 take precedence where they are more recent or specific.

## Important implementation decisions already frozen
- AWS-first, cloud-portable contracts.
- EKS + Node.js/TypeScript/Fastify backend.
- React + Next.js web; Flutter mobile.
- Aurora PostgreSQL is the authoritative v1 datastore. Do not introduce DynamoDB without an approved ADR.
- S3 stores binary evidence/documents; PostgreSQL stores metadata.
- Tenant-owned pooled tables use `tenant_id` + PostgreSQL FORCE RLS.
- OPA = authorization; GoRules = deterministic statutory/business rules; Temporal = durable process sequencing; PostgreSQL = authoritative state.
- Citizen auth initially mobile OTP, identity verification through DigiLocker, later DigiLocker SSO. Workforce auth through Keycloak.
- ServiceForm Studio is a first-class product: visual form/rule/workflow/access/evidence/SLA/credential design with maker-checker publication.
- Services are executable metadata/configuration. Normal onboarding must not require service-specific backend code.
- Published versions are immutable and applications pin exact versions through TenantServiceBinding.
- External dependencies must support REAL / SANDBOX / SIMULATED adapters. Production must never silently use SIMULATED critical connectors.
- AI agents may build, test and produce evidence but may never self-certify a release.

## First task
Do not start coding immediately. Run `prompts/00_ARCHITECTURE_VERIFICATION.md` first and create `docs/audits/ARCHITECTURE-VERIFICATION-001.md`.


UX/UI work: read `DESIGN-SYSTEM.md` and `specs/design-system.yaml`. UX4G Design System 3.0 is mandatory.


## Concurrent AI development
Before running multiple coding agents, read `MULTI-AGENT-DEVELOPMENT.md`, `specs/agent-topology.yaml`, `specs/agent-orchestration.yaml` and use `prompts/07_MULTI_AGENT_ORCHESTRATOR.md`.
## Claude Code multi-agent execution
Claude Code leads/workers must read `CLAUDE-MULTI-AGENT-GUIDE.md` before using Agent Teams, subagents, background sessions, or multiple worktrees.



## Claude model routing and quality
Before assigning Claude models or accepting AI-generated work, read `MODEL-ROUTING-QUALITY.md`, `specs/model-routing-quality.yaml` and use `prompts/12_MODEL_ROUTING_QUALITY_GATE.md` for evidence-based acceptance/escalation.
