# CMP-013 Document Upload Service

Upload sessions, metadata-driven size/type policy, direct-to-object-store upload targets, integrity
verification, quarantine and malware-scan state, and authorized short-lived download access
(Eng v1.4 CMP-013; AWS v1.7 CMP-013). Technical acceptance only: CMP-013 never declares evidence
business-verified (Constitution #15).

## Eng interfaces

- `POST /v1/documents/upload-sessions` (Idempotency-Key) — validates the declaration against the tenant
  upload policy, creates `document_metadata` + `upload_session`, then issues a short-lived PUT target
  through the storage port (outside the DB transaction)
- `POST /v1/documents/{id}/complete` — inspects the stored object via the port; size, SHA-256 and
  content signature must match the declaration and the pinned policy, otherwise `REJECTED`
- `GET /v1/documents/{id}` — metadata only (no object key, no URL)
- `GET /v1/documents/{id}/access` — short-lived download only when `AVAILABLE`
- `POST /v1/upload-policies` (Idempotency-Key), `GET /v1/upload-policies/{code}` — insert-only policy versions

## Lifecycle

`PENDING_UPLOAD -> SCAN_PENDING -> AVAILABLE | REJECTED`. `AVAILABLE` requires a `CLEAN` row in
`document_scan_status` (enforced by a database trigger as well as the service). Scanner outage keeps
`SCAN_PENDING` and re-queues via the outbox until the policy's `max_scan_attempts`, then `SCAN_FAILED`.

## Events (`sf.upload.events.v1`)

`DocumentUploaded`, `DocumentScanRequested`, `DocumentScanned`, `DocumentAvailable`, `DocumentRejected`.
`UploadService.processScanRequest` is the inbox-deduplicated consumer for `DocumentScanRequested`.

## Ports

- `DocumentStoragePort` — CMP-032 storage view; `SimulatedDocumentStorage` builds on `@serviceform/storage`
  (in-process only, no filesystem, INT-013 marker)
- `MalwareScanPort` — `SimulatedMalwareScanner` (INT-013)
- `AuthorizationPort` — OPA PEP, fail closed

## Non-goals

- REAL S3/KMS/GuardDuty adapters (ADR-STORAGE-INFRA)
- OCR / document intelligence (SF-M04-006)
- Host mount and scan-worker wiring (`apps/api` — SF-M04-007)
- CERTIFIED claim
