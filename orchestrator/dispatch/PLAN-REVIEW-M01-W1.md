# PLAN-REVIEW-M01-W1: orchestrator rulings on the wave-1 builder plans

| Field | Value |
|---|---|
| Reviewer | Orchestrator (Claude, Opus, high) |
| Date | 3 October 2026 |
| Plans | /var/tmp/plans/SF-M01-00{1..5}-plan.md (copied to evidence/SF-M01-00N/PLAN.md by each builder) |
| Result | All five plans APPROVED WITH CONDITIONS below. Implementation starts after the security verifier's negative-test files are delivered and each builder adds them to its test list. |
| Escalated to owner | O-1 to O-4 (section 4). None blocks wave 1: each has a safe default here. |

## 1. Cross-cutting rulings (bind all five tasks)

| ID | Ruling |
|---|---|
| X-1 | **Migration timestamp bands** (avoid collisions; `--check-order` holds on a fresh database): 001 = `17595001xxxxx`, 002 = `17595002xxxxx`, 003 = `17595003xxxxx`, 004 = `17595004xxxxx`, 005 = `17595005xxxxx`. File names keep the `_cmp-0NN-` infix the envelopes require. |
| X-2 | **Schema names** `sf_<component>`: `sf_tenant_org` (001), `sf_security` (002), `sf_audit` (003, replaces `cmp031_audit`), `sf_event_bus` (004), `sf_integration_hub` (005). |
| X-3 | **Topics**: one domain-event topic per component, `sf.<component>.events.v1` (`sf.tenant-org`, `sf.security`, `sf.audit`, `sf.event-bus`, `sf.integration-hub`), plus `sf.audit.ingest.v1` for audit submissions. Each producer lists its topics and event types in `services/<cmp>/contracts/topics.json` (its own scope). CMP-038 registers them at integration. |
| X-4 | **Audit hand-off** (001 Q5, 002 Q7, 003 Q2/Q3): producers record audit through their own `AuditRecorder` port. The W1 implementation writes event type `AuditEventSubmitted` (schema_version 1, `data` = exactly one SF-CON-AUDIT-EVENT object) to the producer's own outbox, topic `sf.audit.ingest.v1`, partition key `audit:<audit_id>`, in the same transaction as the audited change. `packages/audit-client` (003) builds and validates these values but never writes SQL. No new shared contract is needed because `data` is the frozen audit-event schema. |
| X-5 | **Event-name conflicts between specs** are resolved by document precedence (AWS v1.7 over Eng v1.4, as in ADR-0002): CMP-031 emits `AuditRecordCreated`; CMP-002 emits `TenantPlacementChanged` for both isolation-class and cell moves. Each component contract lists the Eng v1.4 name as an alias in a comment. |
| X-6 | **Outbox writes before CMP-038 merges**: each producer writes outbox rows with a small helper inside its own service, using exactly the template columns, and marks it `// replaced by packages/outbox at stitching`. 004 owns the reusable library. |
| X-7 | **cell_id without a request context** (webhooks, consumers, jobs): from service configuration `SF_CELL_ID`, validated against `common.cellId`. |
| X-8 | **Errors**: reuse frozen codes with structured `details[].code` (e.g. SF-SYS-003 + `HIERARCHY_CYCLE`, SF-SYS-004 + `PDP_UNAVAILABLE`). No new families (that would need a Contract Change Request). |
| X-9 | **Down migrations** need no `sf:allow-destructive` marker: `migration_lint` checks only the up section. |
| X-10 | **Routes and wiring**: plugins accept a `prefix` option and use Eng v1.4 paths under `/v1`. Nothing is registered in `apps/api` in W1; CMP-036 (W2) wires them. |
| X-11 | **Envelope corrections** (001 Q13/Q14): scope checks use `--base d1d0965`; SF-CON-AUTHZ-DECISION is added to the contract locks of 001, 003 and 005, which code against the authorization port. |
| X-12 | **Test identity**: every RLS/tenant test runs as a non-superuser LOGIN role that is a member of `sf_app` (or `sf_outbox_publisher`), created by the test, never as `postgres`. |
| X-13 | **Defaults not in the specs** (idempotency retention 24 h, clock skew 300 s, connector timeout 10 s / 3 retries / breaker 5 failures per 30 s, PEP timeout 100 ms) are approved as configurable defaults and listed in each EVIDENCE.md as non-spec values. |
| X-14 | **CI gap**: CI runs neither service integration suites, `opa test`, nor a Kafka broker. Because merges wait for green CI (owner, 3 Oct), the Contract Guardian adds those CI jobs before the first wave-1 merge. Builders produce local evidence now. |

## 2. Per-task rulings

### SF-M01-001 (CMP-002)
- Q1: `tenant` and `tenant_cell_binding` are TENANT_SCOPED keyed by their own tenant id; the privileged create sets `app.tenant_id` to the new server-generated id. No platform role, no RLS bypass. Listing all tenants is out of scope.
- Q2: the four extra routes are approved as component-owned additions (component OpenAPI in `services/cmp-002-tenant-organisation/contracts/`).
- Q3: **build maker-checker now** for isolation-class and cell placement changes (AWS v1.7 requires two-person approval; it outranks the envelope's silence): propose by one PRIVILEGED_ADMIN, approve by a different one, both audited.
- Q4: per X-5, one event `TenantPlacementChanged`.
- Q10: refuse every client tenant header (stricter than AWS s13.1's "hint" allowance; approved).
- Q12: per X-8. Q15: deferred to a GLOBAL reference-body design later.

### SF-M01-002 (CMP-048)
- Q1: proceed without choosing pinned vs effective-latest. Record `policy_revision` on every decision; ADR-0005 remains an owner item (O-1).
- Q2: break-glass grants are pushed to the local OPA Data API under `sf_runtime` after the database commit, for M01. Multi-pod distribution and consistency are recorded as a gap for M02. Grant tenant must equal subject and resource tenant (Q3 approved).
- Q4: the AWS s20.12 entities (role_definition, role_permission, delegation_grant, tenant_policy_binding, authorization_decision_audit) are not built in W1; ownership goes to the owner (O-2).
- Q5: no tenant-scoped policy metadata now. Q6: component contracts under `services/cmp-048-security-platform/contracts/`, topics per X-3. Q7: approved. Q8 and Q12: deferred. Q10: 503 SF-SYS-004 on PDP failure (still a deny) approved.

### SF-M01-003 (CMP-031)
- Schema renamed `sf_audit` (X-2); migrations in band 17595003 (X-1).
- Q1: in-database chain only; external anchoring is residual risk under G-11, recorded in EVIDENCE.md.
- Q4: create partitions 24 months ahead plus an idempotent `ensure_partitions()` routine for operations; rows outside the window fail and retry (no loss), with a test.
- Q5: `audit_export_job` deferred to W2 with CMP-032.
- Q6: an envelope rejected for PII dead-letters (its key is per audit id, so nothing else is held). Error SF-SYS-003 with detail `PII_FIELD_REJECTED`. Pattern scanning applies only to free-text fields (`reason`, `before_ref`, `after_ref`), never to ids.
- Q7: only the deny path and the audited attempt are built until CMP-048 grants exist; platform audit stays on `sf_app` with the PLATFORM_OPERATIONAL tables.
- Q8: `client_context` is **not stored** until a policy source exists (privacy default); the field is accepted, dropped, and counted in a metric. Owner item O-3.
- Q10: `purpose` would need a Contract Change Request; not now (O-4).

### SF-M01-004 (CMP-038)
- Q1: approved. Run Apache Kafka 4.1.0 from the tarball in `/var/tmp/kafka` (outside the repo) for real-broker tests and `broker-outage.log`.
- Q2: **no new grant** to `sf_outbox_publisher` (D-02 stays as the owner approved it), and no cross-component SQL. The publisher validates topics and retention against a registry snapshot shipped in `packages/outbox` (generated from `registry/topics.json`); the `sf_event_bus` tables are CMP-038's own record of the same data. This satisfies template rule 6.
- Q3: unregistered topic or schema version: retry with `last_error_code` and an alert, not dead-letter.
- Q4: OTel global meter via `startTelemetry()` approved.
- Q5: operator discard deletes the DEAD_LETTERED row after it is on the DLQ topic, with an audit event (template rule 4 "discards it through an audited action").
- Q6: per X-8. Q7: no change. Q8: approved. Q9: per X-1 (band 17595004).

### SF-M01-005 (CMP-037)
- Q1: **no SECURITY DEFINER.** Use a routing table `sf_integration_hub.webhook_route (binding_id uuid PRIMARY KEY, tenant_id uuid NOT NULL)`, PLATFORM_OPERATIONAL, SELECT for `sf_app`, written in the same transaction as the binding. The webhook resolves the tenant from it, sets the session context, loads the binding under RLS, then verifies the signature before any processing.
- Q2: enforce **REAL for every binding in PRODUCTION** (Eng v1.4 s10.1 allows SANDBOX only in dev, SIT, UAT and pre-prod). This is stricter than the frozen contract, which is allowed; the contract gap is recorded for a Contract Change Request (CR-06 follow-up).
- Q3: repository methods only, approved. Q4: null-tenant bindings are out of W1 scope. Q5: deferred, approved.
- Q6/Q7/Q13/Q15: per X-10, X-3, X-7, X-1 (band 17595005).
- Q9: per X-13. Q10, Q11, Q12: approved as proposed.
- Q14: simulator coverage not measured is recorded as a W2 gap for CMP-055 (workspace and coverage include).

## 3. Approval conditions for all builders
1. Copy your plan to `evidence/SF-M01-00N/PLAN.md` with these rulings applied, as your first commit.
2. Add every case from `/var/tmp/plans/SF-M01-00N-negative-tests.md` to your tests; they are mandatory.
3. Commit on your branch only; never merge; end with `orchestrator/handovers/SF-M01-00N.yaml`.
4. Any new stop condition: stop and report, do not choose.

## 4. Owner items (safe defaults applied, not blocking W1)
- O-1: ADR-0005, authorization policy pinned per case vs effective-latest (AWS v1.7 s20.11 vs s20.15). Default: record revision, decide before M05.
- O-2: owner of the AWS s20.12 access-model entities (likely Studio/Access Designer, M03). Default: not built in W1.
- O-3: whether audit may store source IP / device metadata. Default: not stored.
- O-4: Contract Change Requests to queue: `purpose` on audit events (TI s19); forbid SANDBOX in PRODUCTION in connector-binding (Eng s10.1).
