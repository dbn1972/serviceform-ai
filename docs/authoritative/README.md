# Architecture Document Precedence

Authoritative (this folder):
1. ServiceForm AI Component Functional & Technical Specification AWS v1.7 - current platform architecture.
2. ServiceForm AI Building Block Engineering Specifications v1.4 - current component/integration/certification handbook.
3. ServiceForm AI Tenant Isolation Architecture v1.0 - detailed tenancy security companion.

Background only (`docs/reference/`):
4. Government Service OS Architecture Source of Truth v2.0 - earlier foundation/reference.
5. Government Service OS AI Buildable Master Specification v1.0 - earlier implementation/reference.

Human operating handbook (`docs/handbook/`): Claude Code Multi-Agent Read-Plan-Execute Guide v1.1.

Where newer/specific documents conflict with older/background documents, use the newer/specific document and raise an ADR if ambiguity remains.

Current synchronized baseline: AWS v1.7 + Building Block Engineering v1.4 + Tenant Isolation v1.0. UX4G Design System 3.0 is normative; see root `DESIGN-SYSTEM.md`.
