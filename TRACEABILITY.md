# Traceability

`specs/requirements/` is authoritative for functional requirement IDs. `tests/traceability/requirements-tests.yaml` provides the initial test mapping. Implementations update each requirement with source paths/PR/commit metadata through the project traceability process.

No feature is complete without bidirectional traceability: requirement -> contract -> implementation -> tests -> runtime evidence, and PR/change -> requirement IDs.
