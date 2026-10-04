# `@serviceform/storage`

CMP-032 shared storage ports for Wave 2.

- Object key generation (tenant/cell scoped)
- SHA-256 checksum helpers
- **SIMULATED / local** in-process object-store adapter only (INT-013 simulation markers)
- Presigned access token helpers for simulated URLs

**Not in scope:** REAL S3/KMS cloud resources (requires ADR-STORAGE-INFRA). No durable pod filesystem. No evidence business rules (CMP-013).
