# CMP-032 Storage Service

Object metadata, encryption-policy binding, checksums, and **SIMULATED/local** object-store access (INT-013).

## Eng interfaces

- `POST /v1/storage/objects`
- `GET /v1/storage/objects/{id}/access`
- `POST /v1/storage/objects/{id}/archive`

## Events

- `ObjectStored`, `ObjectArchived`, `ObjectDeleted` on `sf.storage.events.v1`

## Non-goals (Wave 2)

- REAL S3/KMS (ADR-STORAGE-INFRA)
- Evidence business rules (CMP-013)
- Host mount (`apps/api` — SF-M01-W2-004)
- CERTIFIED claim
