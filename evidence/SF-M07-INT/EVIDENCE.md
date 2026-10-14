# SF-M07-INT evidence — independent integration stitcher (INT-008 / INT-011 / INT-013)

**Not CERTIFIED. Not G3. Not G6. self_certified false. Recommend only.**

| Field | Value |
|---|---|
| Task | SF-M07-INT |
| Authorization | `HUMAN_M07_THROUGH_EVD_AUTHORIZATION = true` |
| Branch | `cursor/m07-int-91f2` (dedicated worktree; shared checkout was in use by SF-M07-SEC) |
| Base | `dfa96a0e8b61754d2ed6323bae8455caf5a285aa` (host #149 merge on main) |
| Tests commit | `27c0017` (see `logs/vitest.log` for full SHA) |
| Run | local vitest 5.0.3, node 22.14, no PostgreSQL |
| Model | route `opus`, release `claude-opus-5-5` |
| Suites | INT-008 path · INT-008 no-reversal · INT-011 seams · INT-011 host · INT-013 modes |
| Result | **67 tests: 60 PASS, 7 expected-fail (recorded findings), 0 unexpected failures** |
| Findings exposed run | `M07_INT_SHOW_FINDINGS=1` → 7 fail / 60 pass (`logs/findings-exposed.log`) |
| Owner regression (read-only) | M07 services 332/332 PASS; `apps/api` composition-m07 10/10 PASS |
| eslint / prettier / typecheck | PASS / PASS / PASS (`logs/eslint.log`, `logs/prettier.log`, `logs/typecheck.log`) |
| Production code modified | **false** (`git diff origin/main -- services apps contracts db packages` empty) |
| CROSS_TENANT_LEAKAGE | **0** (seam probes ≥ 40 + host probes; aggregate assertion passes in both run modes) |

Command: `npx vitest run --config tests/integration/m07/vitest.config.ts`
Artifacts: `junit/independent-int.xml`, `logs/*.log`.

## What is exercised

Real CMP-022 / CMP-024 / CMP-023 / CMP-012 factories, services and transport-neutral handlers.
Persistence uses each owner's in-memory repository double unchanged (persistence is not the seam
under test). Every cross-component port is a stitcher-owned adapter in
`tests/integration/m07/support/wiring.ts`:

- CMP-022 → CMP-024 `RegistryBridge` (registration, issuer_ref from tenant metadata)
- CMP-023 → CMP-022 `CredentialReadBridge` and CMP-023 → CMP-024 `RegistryStatusBridge`
  (via published `createCredentialStatusReadPort`)
- CMP-015 approval pins, CMP-032/033 render, INT-013 eSign signer, CMP-037 DigiLocker binding
  are doubles; DigiLocker adapter is the owner `SimulatedDigiLockerConnector`.

`int-011-host.test.ts` mounts the same real services into `apps/api` `buildApp` through
`composition/m07.ts` (SF-M07-005) and drives the full chain over HTTP.

| INT | Key assertions (PASS) |
|---|---|
| INT-008 | approval → GENERATED → SIGNED (SIMULATED, marker) → CMP-024 REGISTERED → ISSUED → ACTIVE → QR mint → public verify → DigiLocker PUBLISHED → downstream outcome; credential, signing-record, credential-status, verification-token, event-envelope and error-response payloads validate against FROZEN schemas; no port called with any component tx open; unapproved → SF-WF-001 with nothing downstream; client-supplied approval/status/pins → SF-SYS-003; citizen issuance → SF-AUTH-002; FAILED eSign stays GENERATED, not registered, not QR-mintable, retry re-signs; CMP-024 outage leaves SIGNED, retry resumes with exactly one registry entry; idempotent replay without re-sign/re-register, key reuse with different body → SF-APP-002; QR status is live from CMP-024 (SUSPENDED/REVOKED reflected, credential stays ISSUED); CMP-024 outage → QR verify SF-INT-001 with no cached status; public view carries no credential/tenant/application/token id |
| INT-008 no-reversal | DigiLocker provider failure scenario and transport outage → FAILED record with `issuance_reversed_on_publish_failure=false`; binding-registry outage → SF-SYS-004 with no connector call; notification outage recorded as FAILED outcome (idempotent); in all cases credential stays ISSUED, registry ACTIVE v2, QR still ACTIVE, no revoke/compensate events; CredentialIssued payload declares non-reversibility; officer/citizen cannot record outcomes |
| INT-011 | tenant B gets 404 for every tenant-A credential/signing/status/token/publish read and an empty application list; tenant-A opaque QR does not verify under tenant B; tenant B cannot revoke, mint QR or record outcomes on tenant-A credentials; same application id in two tenants → distinct credential ids/registry partitions; forged `x-tenant-id` / `X-Tenant-ID` / `x-sf-tenant` / `Forwarded: tenant=` → SF-TEN-002 on every CMP-022/024/023 route with no writes; body `tenant_id` refused; CMP-023 blocks cross-tenant records returned by a misbehaving CMP-022 or CMP-024 port (SF-TEN-002, nothing persisted); CMP-012 refuses another tenant's binding (SF-TEN-002); every PDP request carries the server-derived tenant. Host: all four mounts, full chain over HTTP, tenant-B sessions 404 with zero leakage, forged headers → 403 SF-TEN-002 on all 13 M07 routes **including CMP-012** (CMP-036 gateway), missing session fails closed |
| INT-013 | CMP-022: SIMULATED eSign refused in UAT/PREPROD/PRODUCTION and when environment is unset (defaults to PRODUCTION) — no signing record, GENERATED, registry untouched; SIMULATED accepted in LOCAL/CI/DEVELOPMENT/SIT/PERFORMANCE only with matching marker; missing/mismatched marker refused; REAL with marker refused; REAL in PRODUCTION recorded without marker. CMP-012: PRODUCTION+critical SIMULATED/SANDBOX → CRITICAL_NON_REAL_IN_PRODUCTION; PRODUCTION non-critical SIMULATED, UAT/PREPROD SIMULATED → refused; env mismatch, REAL in CI, REAL without secret_ref, missing test_run_id, wrong connector type, missing binding → refused with no connector call and no record; CI SIMULATED record carries a conformant SF-CON-SIMULATION-MARKER |

## Findings (recorded against owning component; no owner code patched)

Contract violations are encoded as expected-failure tests (`finding(...)` in the suites) so they
flip to a failure when the owner fixes them. Characterised items assert observed behaviour.

| ID | Sev | Owner | Finding | Evidence |
|---|---|---|---|---|
| M07-INT-F01 | HIGH | CMP-012 | Publish never checks the credential with CMP-022. It hardcodes `credential_lifecycle_status_at_request='ISSUED'`, so a never-issued id (F01), a GENERATED/unsigned credential (F01b) and, in tenant B, a credential id that exists only in tenant A (F01c, no data leaked but a cross-tenant reference is persisted) are all PUBLISHED with 201. Violates SF-CON-DIGILOCKER-PUBLISH "Only ISSUED credentials are published". The storage key sent to DigiLocker is synthesized (`credentials/{tenant}/{credential}`) rather than the CMP-022 signed artifact. Direction: add a read-only credential port (as CMP-023 has) bound by the host. | `int-008-issuance-path` F01/F01b, `int-011-tenant-isolation` F01c |
| M07-INT-F05 | HIGH | CMP-012 | Component forged-header guard is a 3-name denylist (`x-real-tenant-id`, `x-bypass-rls`, `x-override-tenant`). `x-tenant-id`, `x-sf-*`, `Forwarded: tenant=` reach the service (GET → 404, not SF-TEN-002). `requireTenantContext` also skips UUID/actor/correlation validation and maps a null context to SF-TEN-001 (siblings: SF-AUTH-001). Mitigated in the composed host: CMP-036 returns 403 SF-TEN-002 for CMP-012 routes, and context stays server-derived (leakage 0). Defence-in-depth gap at the component boundary. | `int-011-tenant-isolation` F05; host test PASS |
| M07-INT-F06 | HIGH | CMP-012 | Injected adapter mode is never reconciled with the binding. PRODUCTION runtime + REAL critical binding + `SimulatedDigiLockerConnector` → 201 PUBLISHED, recorded as `connector_mode: REAL`. A SIMULATED critical connector can run in PRODUCTION and be mislabelled (Constitution #22). Currently prevented only by host wiring discipline ("REAL DigiLocker deferred"). | `int-013-modes` F06 |
| M07-INT-F03 | MEDIUM | CMP-012 | Publish GET/POST body is not projectable to FROZEN SF-CON-DIGILOCKER-PUBLISH: missing contract_id/contract_status/freeze_status, tenant_id, credential_lifecycle_status_at_request, consent_ref, purpose_code, connector_binding_id, integration_contract, idempotency_key, invented_statutory_policy_forbidden, simulation_marker; extra `created_at`. Owner contract test validates a hand-built payload, not service output. | `int-008-issuance-path` F03 |
| M07-INT-F04 | MEDIUM | CMP-012 | Audit envelope uses `event_type: 'AuditEvent'` with envelope `tenant_id: null`; CMP-022/023/024 and 40 other components emit tenant-scoped `AuditEventSubmitted`. Audit-ingest routing/partitioning by envelope tenant would misfile CMP-012 audits. | `int-008-issuance-path` F04 |
| M07-INT-F02 | MEDIUM | seam CMP-022/CMP-024 (orchestrator/ADR) | Actor sets disagree: CMP-022 issues for SYSTEM or OFFICER; CMP-024 registers SYSTEM only. With the issuing context passed through, an OFFICER issuance stalls at SIGNED (a later SYSTEM retry with the same issuance_key resumes). The host bridge's identity policy (pass-through vs workload swap) is undefined; not invented here. | `int-008-issuance-path` F02 (characterised) |
| M07-INT-O1 | LOW | CMP-022 / CMP-037 | CMP-022 accepts a SANDBOX eSign result in PRODUCTION; the adapter result carries no criticality, so PRODUCTION+critical→REAL relies solely on the (not yet REAL) CMP-037 binding resolver. | `int-013-modes` O1 |
| M07-INT-O2 | LOW | CMP-012 | `runtimeEnvironment` defaults to LOCAL when unset (CMP-022 defaults to PRODUCTION). The binding-environment equality check limits exposure. | `int-013-modes` O2 |
| M07-INT-O3 | LOW | host composition (CMP-036 / orchestrator) | Seam shape gaps the host must bridge with undocumented policy: CMP-022 RegistrationRequest has no `issuer_ref` (CMP-024 requires one); CMP-023 read ports are context-free `{tenantId, credentialId}` while CMP-022/CMP-024 reads require a TenantContext, so the host must mint a workload context (actor/correlation not propagated). | `support/wiring.ts` bridges |

## Honest boundaries (not exercised here)

- PostgreSQL RLS / privilege roles for the M07 schemas (owner `*.int.test.ts`; not run here).
- REAL/SANDBOX eSign (CMP-037) and REAL DigiLocker; CMP-015 approval, CMP-032/033 render, CMP-025
  notification are doubles. No REAL critical connector validation is claimed.
- Outbox relay / CMP-038 delivery of the emitted envelopes.
- No statutory eSign/DigiLocker policy, document type or reason code is defined; all are opaque refs.

## Gate recommendation (human/CI decides)

Blocking hard gates: tenant isolation at the composed host PASS (leakage 0, SF-TEN-002 on all
routes); CMP-022 PRODUCTION SIMULATED fail-closed PASS. CMP-012 fails component-level hard checks
(F05 forged-tenant SF-TEN-002, F06 SIMULATED adapter under PRODUCTION binding) and the
SF-CON-DIGILOCKER-PUBLISH contract (F01, F03).

recommended_result: `SF_M07_INT_FINDINGS_BLOCKING` — do not issue M07 G3 until CMP-012 remediates
F01/F05/F06 (F03/F04 before EVD) and the orchestrator decides F02. CMP-022/CMP-024/CMP-023 seams:
no blocking findings.

CERTIFIED=false · G3=false · G6=false.
