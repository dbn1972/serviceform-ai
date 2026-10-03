# GitHub Copilot Instructions - ServiceForm AI

Follow `AGENTS.md`, `ARCHITECTURE-CONSTITUTION.md`, `specs/build-plan.yaml` and the applicable component/integration specifications.

Prefer generic metadata-driven capabilities over service-specific code. Preserve PostgreSQL FORCE RLS, OPA authorization, deterministic GoRules decisions and Temporal workflow boundaries. Never write across component-owned schemas. All material state changes require transactional outbox. Add tests/traceability with code. Do not weaken security or claim certification without executed evidence.


UX/UI work: read `DESIGN-SYSTEM.md` and `specs/design-system.yaml`. UX4G Design System 3.0 is mandatory.


For multi-agent/parallel work, follow `MULTI-AGENT-DEVELOPMENT.md`: respect task-envelope write scopes, FROZEN contracts, branch isolation and independent verification.
