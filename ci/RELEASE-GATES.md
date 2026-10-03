# Release Gates

G0 DESIGN_READY: requirements, contracts and ADRs are sufficient.
G1 BUILD_READY: architecture verification and repository bootstrap pass.
G2 COMPONENT_VERIFIED: component tests and failure paths executed.
G3 INTEGRATION_VERIFIED: relevant INT contracts pass end to end.
G4 SECURITY_VERIFIED: tenant isolation/authz/privacy/security tests pass.
G5 PERFORMANCE_RESILIENCE_VERIFIED: load, soak, chaos, recovery and backup/restore evidence pass where applicable.
G6 RELEASE_CERTIFIED: immutable evidence bundle reviewed by an authorized human; production connector inventory confirms critical connectors REAL.


## UX4G conformance gate
For any UI-impacting change, CI must verify approved UX4G dependency/version, no unapproved parallel design-system dependency, token usage policy, Storybook/component tests, accessibility/keyboard checks and visual regression. Release-critical journeys additionally require manual accessibility evidence.
