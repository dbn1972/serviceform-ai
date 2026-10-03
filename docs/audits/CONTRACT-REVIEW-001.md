# CONTRACT-REVIEW-001: shared contracts before the M01 freeze

| Field | Value |
|---|---|
| Role | Architecture & Contract Guardian (Claude, Opus route) |
| Date | 3 October 2026 |
| Scope | All 13 entries in `orchestrator/contracts-lock.yaml`: the 11 M00 drafts plus the two contracts M01 wave 1 needs (SF-CON-DB-SESSION-CONTEXT, SF-CON-OUTBOX) |
| Checked against | AWS v1.7 s4.3, s13, s14, s20.3-20.6, CMP-031/037/038; Eng v1.4 s3, CMP-031/037/038/048, s10; TI v1.0 s6-s8, s13; Constitution #11, #22, #24; `simulators/README.md`; `specs/error-codes.yaml` |
| Result | 13 findings, 12 fixed, 1 recorded. Decisions D-01 to D-05 accepted by the owner on 3 October 2026 as recommended; all 13 contracts FROZEN the same day with ADR-0002. |
| Prompted by | Dispatch plan DISPATCH-PLAN-M01-W1, items P-03 and P-04 |

## 1. Findings

| ID | Severity | Contract | Finding | Fix |
|---|---|---|---|---|
| CR-01 | HIGH | DB session context (all RLS) | The policy form in TI v1.0 s8 and the M00 RLS harness, `tenant_id = current_setting('app.tenant_id', true)::uuid`, **raises an error on a reused pooled connection**. After a `SET LOCAL` transaction ends, PostgreSQL keeps the custom setting as `''`, and `''::uuid` fails with "invalid input syntax for type uuid". Reproduced on PostgreSQL 16; covered by a new regression test. Every pooled service would fail its next tenant-less transaction on that connection. | New accessor `sf_platform.current_tenant_id()` (`NULLIF(..., '')::uuid`) in migration `1759490000000_shared-db-contracts.sql`. `migration_lint` now refuses a policy that reads `app.tenant_id` directly. Harness switched to the accessor, with a reused-session test. |
| CR-02 | HIGH | (missing) outbox | Five wave-1 components must write events in the same transaction as their state (AWS v1.7 s4.3, s13.2; Constitution #11), but no contract fixed the table shape, publisher protocol or consumer dedup. Each builder would have invented one. | New **SF-CON-OUTBOX**: `outbox-record.schema.json` and the normative DDL `sql/outbox.template.sql` (outbox, platform outbox, inbox, grants). DB tests prove producer/publisher separation and tenant isolation. |
| CR-03 | HIGH | (missing) DB session context | The `app.tenant_id` convention existed only in a test file. Actor, cell and correlation settings were undefined. | New **SF-CON-DB-SESSION-CONTEXT**: `db-session-context.schema.json`, accessor functions, and `dbSessionSettings()` in `packages/contracts`, which maps a RequestContext to the settings. |
| CR-04 | MEDIUM | SF-CON-AUTHZ-DECISION | `input.environment` was an open object. Personal data could reach OPA inputs and decision logs, against AWS v1.7 s20.3 ("approved contextual facts only") and s20.6. | Closed object: `request_time`, `client_id`, `risk_flags`, `trace_id` (the last for decision logs, s20.6). |
| CR-05 | MEDIUM | SF-CON-AUDIT-EVENT | Eng v1.4 CMP-031 says every record carries tenant, **cell**, actor, trace and **classification**. Cell and classification were missing, and AWS v1.7 s14.3 source IP/device metadata had no place. | `cell_id` required; optional `classification` and `client_context` added. |
| CR-06 | MEDIUM | SF-CON-CONNECTOR-BINDING | `tenant_id` could be omitted, which AWS v1.7 s14.1 forbids (no accidental global). REAL/SANDBOX bindings could have no secret reference. SIMULATED was allowed in UAT, PREPROD and non-critical PRODUCTION, while `simulators/README.md` and the simulation-marker contract allow it only in LOCAL, CI, DEVELOPMENT, SIT and PERFORMANCE. | `tenant_id` required (nullable); `service_id` added; REAL/SANDBOX require `secret_ref`; SIMULATED limited to those five environments and requires `simulator_version`. |
| CR-07 | MEDIUM | SF-CON-REQUEST-CONTEXT | TI v1.0 s6 scopes service accounts to an explicit integration purpose; the context had no field for it. | Optional `purpose`, required when `actor.type` is INTEGRATION. |
| CR-08 | LOW | several | Roles, resource types, action codes, assurance and trace ids had different formats in different contracts (free strings in authz, patterns elsewhere). | Shared `$defs` in `common.schema.json` (`roleCode`, `actionCode`, `resourceType`, `authAssurance`, `purposeCode`, `traceId`) used everywhere. |
| CR-09 | LOW | SF-CON-IDEMPOTENCY | A COMPLETED record could have no `response_ref`, so a replay could not return the original response (AWS v1.7 s13.4). | `response_ref` required when COMPLETED. |
| CR-10 | LOW | SF-CON-ISOLATION-DECLARATION | `owner_component` accepted CMP-000 and CMP-062 to 069. | Pattern limited to CMP-001..CMP-061. |
| CR-11 | LOW | SF-CON-ERROR-CATALOGUE | `specs/error-codes.yaml` lacked the authoritative SF-RATE family (AWS v1.7 s13.3) and the proposed SF-SYS family that the catalogue and `common.errorCode` already use. | Both families added to `specs/error-codes.yaml`; SF-SYS stays marked proposed (ADR-0002). |
| CR-12 | LOW | lock gate | `contracts_lock_gate.py` hashed one file per contract, so a contract whose normative text spans a schema and a SQL template could drift while FROZEN. | `companions` list with per-file SHA-256, checked like the main file; gate self-test added. |
| CR-13 | INFO | tooling | `migration_lint.py` scans `services/*/migrations`, but the migrator only applies `db/migrations`. | Not changed. Wave-1 envelopes put migrations in `db/migrations`; CMP-055 (wave 2) should align the two. |

The event envelope (SF-CON-EVENT-ENVELOPE), error response and simulation marker needed no change
beyond the shared `$defs`. The snake_case decision itself is ADR-0002's, not this review's.

## 2. Evidence

All runs on the change commit, PostgreSQL 16 local, Node 22.22.0.

| Check | Result |
|---|---|
| `pnpm contracts:validate` (strict compile of 12 schema files, 14 valid and 19 invalid examples; each invalid one fails only for its intended reason) | 12 contract names, 0 failures |
| `pnpm test:coverage` (includes new `packages/contracts` tests for `dbSessionSettings`, outbox rows, integration purpose) | 33 passed; lines 95.8%, branches 83.1% |
| `pnpm db:test` (migration round trip, RLS harness incl. reused-session regression, outbox/inbox contract suite) | 16 passed |
| `pytest scripts/gates/tests` (incl. raw-setting lint, rendered outbox template lint, lock companion drift) | 17 passed |
| `pnpm gates`, `pnpm lint`, `pnpm typecheck`, `pnpm deps:graph`, `prettier --check` | all pass |

## 3. Decisions for the owner before freezing (all accepted as recommended, 3 October 2026)

| ID | Decision | Recommendation |
|---|---|---|
| D-01 | AWS v1.7 CMP-038 says the event envelope carries "data classification"; the s13.2 envelope does not. | Keep s13.2 as is for v1 (events are PII-minimised and carry no classified payload). Add a field later through a v2 envelope if a consumer needs it. |
| D-02 | The outbox publisher role reads every tenant's outbox rows. TI v1.0 s13 allows cross-tenant event aggregation only by an explicitly approved platform service. | Approve `sf_outbox_publisher` as that service: it can read and mark outbox tables only, never business tables, and holds no BYPASSRLS. |
| D-03 | Envelope size cap of 256 KiB in the outbox (a guardian default, not a figure from the specifications). | Approve; it keeps events well under the MSK default message size and enforces AWS v1.7 s13.2 "never embed large payloads". |
| D-04 | SIMULATED connectors limited to LOCAL, CI, DEVELOPMENT, SIT and PERFORMANCE. This is stricter than Constitution #22, which only forbids SIMULATED critical connectors in production. | Approve; it matches `simulators/README.md` and the simulation-marker contract. |
| D-05 | RLS policies use `sf_platform.current_tenant_id()` instead of the literal TI v1.0 s8 example. The rule (transaction-local `SET LOCAL`, FORCE RLS) is unchanged; only the expression is corrected. | Approve as a clarification of TI v1.0 s8, recorded here. |

Accepted by Debabrata Nayak (owner), 3 October 2026, in the ServiceFormAi project thread ("yes i accept", 10:26 UTC, replying to Claude's recommendation to accept ADR-0001, ADR-0002, ADR-0004 and CONTRACT-REVIEW-001 D-01 to D-05 and freeze the 13 contracts); recorded by Claude. The Contract Guardian then set all 13 entries to FROZEN in
`orchestrator/contracts-lock.yaml` with their current hashes.
