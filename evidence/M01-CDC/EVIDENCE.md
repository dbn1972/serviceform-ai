# M01 Wave 1 CDC evidence (F-V1-CDC / R9)

| Field | Value |
|---|---|
| Finding | F-V1-CDC |
| Lane | R9 |
| Baseline (immutable) | `d33601a5c2c332548530897df1bd35702317df44` (PR #21 frozen) |
| Remediation branch | `cursor/m01-w1-remediation-r1` (PR #22) |
| Candidate SHA | `220e5a8c95890e711326d5146ade55073e44a3aa` |
| Command | `pnpm test:cdc` |
| CI hook | `.github/workflows/ci.yml` quality job step `consumer-driven contracts (Wave 1 CDC)` — failure fails the workflow |
| Frozen contracts used | SF-CON-EVENT-ENVELOPE, SF-CON-AUDIT-EVENT (no frozen-contract edits) |
| Result | Local: 3 files / 19 tests passed (see `junit.xml`) |
| Gate claim | Not CERTIFIED — evidence for V1/V5 re-run on GitHub-executed SHA |

## Relationships covered

1. CMP-002 OpenAPI 3.1 / AsyncAPI 3.0 consumer expectations + breaking rejection
2. CMP-002 / CMP-048 / CMP-037 `AuditEventSubmitted` envelopes → CMP-031 `sf.audit.ingest.v1` (schema_version 1) + incompatible rejection
3. CMP-038 registry/snapshot topic compatibility vs producer payloads + BACKWARD break rejection

## Residual (not R9 production change)

Domain topics declared in producer `contracts/topics.json` (e.g. `sf.tenant-org.events.v1`) are not all present in `services/cmp-038-event-bus/registry/topics.json` yet (PLAN-REVIEW X-3 stitch registration). CDC hard-requires `sf.audit.ingest.v1` only. Expanding the registry is CMP-038/stitch scope beyond test-only R9.
