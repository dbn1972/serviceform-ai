# SF-M04-004 CMP-013 Document Upload — implementation plan

## Scope

- `services/cmp-013-document-upload`: Fastify plugin, upload service, storage/scan ports, SIMULATED adapters
- `db/migrations/*_cmp-013-*.sql`: `sf_upload`, `sf_cmp013_rw`, SF-CON-OUTBOX template copy

## Traceability

| Requirement | Implementation | Evidence |
|---|---|---|
| Eng v1.4 CMP-013 upload session | `createUploadSession` | `upload-http.test.ts`, `api-flow.int.test.ts` |
| Size/type policy from metadata | `upload_policy` insert-only versions; `domain/policy.ts` | policy fail-closed tests |
| Checksum validation | `evaluateObserved` (SHA-256, size, content signature) | checksum/size/type mismatch tests |
| Quarantine/scan state | `document_scan_status`, transition trigger, `processScanRequest` | malware/outage/duplicate tests, DB guard test |
| Authorized short-lived download | `issueAccess` (AVAILABLE only) | access tests |
| INT-011 tenant isolation | FORCE RLS, server-derived context, port tenant-key ownership | `privilege-rls.int.test.ts` |
| INT-013 simulation | SIMULATED adapters refuse non-simulation envs; plugin refuses SIMULATED critical in PRODUCTION | INT-013 tests |
| Constitution #11 | `UploadService.external` refuses port/PDP calls inside a transaction | in-transaction probe tests |

## Stop conditions honored

- No frozen shared contract edits; no `pnpm-lock.yaml`, `apps/**`, `specs/**` edits
- No REAL object store, no OCR, no host mount
- `self_certified: false`, `not_certified: true`
