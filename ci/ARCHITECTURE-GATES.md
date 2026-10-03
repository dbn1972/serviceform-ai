# CI Architecture Gates

Initial validation is `python scripts/validate_specs.py`. As code is generated, extend CI with executable gates for:
1. architecture dependency rules;
2. tenant/RLS coverage and cross-tenant adversarial integration tests;
3. OpenAPI/AsyncAPI compatibility;
4. SAST/dependency/secret/IaC scans;
5. unit/integration/e2e + requirement traceability;
6. accessibility checks for changed UI;
7. performance/load budgets;
8. AI evaluation and prompt-injection tests for AI capabilities;
9. migration/restore smoke tests for data changes.


## UX4G conformance gate
For any UI-impacting change, CI must verify approved UX4G dependency/version, no unapproved parallel design-system dependency, token usage policy, Storybook/component tests, accessibility/keyboard checks and visual regression. Release-critical journeys additionally require manual accessibility evidence.
