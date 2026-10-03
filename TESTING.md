# Testing Strategy

Every test links to at least one requirement ID.

Required layers:
- Unit tests for pure domain/rule logic.
- Schema/contract tests for JSON Schema/OpenAPI/AsyncAPI.
- Integration tests for database, cache, event, workflow and connectors.
- E2E golden paths and negative/error recovery paths.
- Tenant-isolation adversarial tests across DB/cache/search/object/event/AI contexts.
- Workflow concurrency/idempotency and external callback duplication tests.
- Accessibility checks for citizen/admin UI changes.
- Security negative tests (IDOR, authz, injection, SSRF, upload, secrets).
- Performance budgets/load tests for hot paths.
- AI grounding/prompt-injection/evaluation tests for AI capabilities.
- Backup/restore and DR transactional smoke tests before production scale-up.


## UX4G experience verification
UI certification requires component tests, keyboard traversal, automated accessibility, contrast/token checks, responsive and 200% zoom/reflow, multilingual truncation, visual regression and release-critical screen-reader smoke tests. Golden Residence Certificate G6 evidence must include UX4G conformance across citizen web/mobile and officer workbench.
