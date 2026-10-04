# CMP-052 Versioning & Configuration Registry

Immutable published versions and TenantServiceBinding pins (INT-002, INT-011, INT-013). Applications pin exact published versions.

## Eng interfaces

- `POST /v1/tenant-service-bindings`
- `GET /v1/tenant-service-bindings/{id}`
- `PATCH /v1/tenant-service-bindings/{id}`
- `POST /v1/tenant-service-bindings/{id}/publish`
- `GET /v1/artifact-versions/{id}`

Publish requires an approved CMP-051 review via ApprovalPort. Published rows cannot be updated or deleted.

## Non-goals

- Studio UI / host mount
- Cross-component SQL to catalogue or metadata
- CERTIFIED claim
