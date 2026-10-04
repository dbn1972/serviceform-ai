# CMP-033 Metadata / Configuration Service

Draft metadata documents, structural schema validation, and config composition (INT-002 validation slice, INT-011, INT-013 SIMULATED/fail-closed).

## Eng interfaces

- `POST /v1/metadata/documents`
- `GET /v1/metadata/documents/{id}`
- `PATCH /v1/metadata/documents/{id}`
- `POST /v1/metadata/documents/{id}/validate`
- `POST /v1/metadata/documents/{id}/publish`
- `POST /v1/metadata/bundles`

Published documents and bundles are immutable (application + database trigger). Studio UI is SF-M03-007 (out of scope). Maker-checker / versioning are SF-M03-004.

## Events

- `MetadataDocumentCreated`, `MetadataDocumentUpdated`, `MetadataDocumentValidated`, `MetadataDocumentPublished`, `MetadataBundleComposed` on `sf.metadata.events.v1`

## Non-goals

- Studio / admin portal UI
- Maker-checker workflow (CMP-051)
- TenantServiceBinding registry (CMP-052)
- Named-service branching or statutory rule content
- CERTIFIED claim
