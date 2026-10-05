# SF-M04-SEC independent security evidence

**Not CERTIFIED. Not G3. Not G6. Not RELEASE CERTIFIED.**  
Independent verifier recommendation only: **`V1_SECURITY_PASS`**.  
**EVD OFF. M04 G3 NOT ISSUED. M05 OFF.**

## Identity

| Field | Value |
| --- | --- |
| Task | SF-M04-SEC |
| Role | independent security verifier (tenant / AI / document) |
| Production base | `afc8e253d4c566a4a18b1e01d9b0a1163f9d6adf` (merge #78 host SF-M04-007) |
| Verifier head | `cf23d8672f3fceafb5f23484e10e0973ab9c8bee` |
| Components | CMP-008, CMP-009, CMP-011, CMP-013, CMP-014, CMP-039 |
| INT | INT-011 (tenant isolation), INT-013 (upload/OCR simulation fail-closed) |
| Unmerged siblings | SF-M04-INT **not** consumed as production source of truth |
| `production_code_modified` | **false** |

## Executed results

| Check | Result |
| --- | --- |
| Independent vitest (`tests/security/m04`) | 3 files, **17/17 pass** |
| LOGIN-role catalog | **296 pass / 0 fail** |
| `CROSS_TENANT_LEAKAGE` | **0** |
| SUPERUSER findings | **0** (9 runtime/group roles probed) |
| BYPASSRLS findings | **0** (9 roles probed) |
| Runtime ownership violations | **0** (owners=`sf_migrator`; runtime not owner) |
| `*_rw` NOLOGIN | **pass** (all M04 privilege roles) |
| FORCE RLS probes | **33** ENABLE + **33** FORCE on tenant-authoritative tables |
| Cross-tenant probes | **17** TI.* (SELECT/INSERT/UPDATE/unset) |
| Cross-component SQL LOGIN SELECT | **8** XCOMP.* → `42501` |
| Forged / client-controlled tenant headers | HTTP 403 `SF-TEN-002`; canary absent |
| Tenant body/query forgery | not trusted; canary absent |
| OPA deny / PDP unavailable | fail-closed (`SF-AUTH-002` / `SF-SYS-004`) |
| Direct provider bypasses | **0** (CMP-014 AiGatewayPort only; host no SDK) |
| Statutory AI paths | **0** (task-kind CHECK + guard + `NOT statutory_decision`) |
| Secret/PII leakage | **0** (logs/bodies; redaction; audit metadata only) |
| SIMULATED as REAL in PRODUCTION | refused (`SF-INT-001`) |
| Host CMP-036 duplicate | **0** (registered once; not remounted by M04) |
| Frozen contracts | **13/13 MATCH** (`contracts_lock_gate` PASS) |
| Path uniqueness envelope | `state: READY`, `dispatched: false` |
| Write scope vs envelope | PASS (allowed paths only) |
| Production / contracts / migrations / grants / RLS | **untouched** |

## Coverage map (required surfaces)

1. Runtime/database roles — SUPERUSER=0, BYPASSRLS=0, ownership=0, `*_rw` NOLOGIN
2. RLS ENABLE+FORCE on all M04 tenant-authoritative tables; negative tenant probes
3. Cross-tenant isolation CMP-008/009/011/013/014/039 — SELECT/INSERT/UPDATE/API
4. Tenant-forgery headers/body/query/path — not trusted server context
5. Authz OPA deny fail-closed; unavailable PDP ≠ allow
6. AI security via CMP-039; CMP-014 no provider bypass; source ACL/purpose defaults deny; redaction; model pin allowlist; no prompt/credential logs; rate-limit wiring present
7. Statutory boundary — AI cannot approve/reject/eligibility/entitlement/evidence-satisfy
8. Document security — safe object keys; traversal rejected; tenant ownership; CLEAN-before-AVAILABLE; malware/simulation fail-closed
9. Simulation — PRODUCTION critical SIMULATED refused
10. Host — no auth/tenant bypass; no duplicate CMP-036; no direct provider; no cross-component SQL

## Explicit residuals (not leakage)

- SF-CON-OUTBOX publisher `USING true` and `sf_app` INSERT on outbox/inbox templates remain frozen (ADR-0006 #9). Counted as residual, **not** `CROSS_TENANT_LEAKAGE`.
- CMP-014 GET with empty repository double may 500 after authz in some stub mounts; forged-tenant and deny-authorizer probes on peer M04 routes remain fail-closed. Classified **A harness** residual, not production defect.

## Defects

None blocking. No silent waiver. No production patch from this verifier branch.

## Handover uniqueness

`orchestrator/handovers/SF-M04-SEC.yaml` and `orchestrator/tasks/SF-M04-SEC.yaml` left at **READY / dispatched false**. Gate `cg01_path_uniqueness_gate.py` was not weakened.

## Recommendation

**`V1_SECURITY_PASS`** from executed evidence only.  
Do **not** start SF-M04-EVD until INT and SEC both immutable PASS. Human/CI gate remains required. `certified: false`.
