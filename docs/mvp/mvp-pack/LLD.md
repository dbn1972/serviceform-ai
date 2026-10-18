# LLD — ServiceForm AI MVP (low-level design)

**Document class:** Low-Level Design (golden slice + critical seams)  
**Tip SHA:** `0ceb890e4007242be7b4fd3800c208063b6d7502`  
**CERTIFIED:** false · **G6:** false · DigiLocker/Payment REAL = **G6-HOLD**

Per-CMP LLD remains in OpenAPI/AsyncAPI/migrations/READMEs. This document deep-dives the MVP golden slice.

---

## 1. Repository layout (implementation units)

| Path | LLD role |
|---|---|
| `services/cmp-*/` | Bounded component services + `contracts/openapi.*` |
| `contracts/shared|m05|m06|m07|m08|m09/` | FROZEN schemas / examples |
| `db/migrations/` | Schema + RLS + immutability triggers |
| `policy/` | OPA bundles |
| `apps/api/src/composition/` | Host plugin mounts |
| `apps/web-*` | UX4G surfaces |
| `templates/residence-certificate/` | Golden metadata LLD |
| `fixtures/golden/ind-soc-002/` | Overlay + TSB + maker-checker fixtures |
| `packages/service-packages/ind-soc-002/` | `.sfpackage` scaffold |
| `packages/m10-sample-lab/` | SAMPLE_LAB JSON store — demo only (`@serviceform/m10-sample-lab`) |
| `tests/e2e/golden/`, `tests/integration/m10/` | Executable LLD verification |

---

## 2. IND-SOC-002 metadata LLD

### 2.1 Service record (`service.yaml`)

| Field | Value |
|---|---|
| `catalogue_id` | `IND-SOC-002` |
| `version` | `0.2.0-odisha-sample` |
| `status` | `SAMPLE_CANDIDATE` |
| `pilot_state_or_jurisdiction` | `IN-OD` |
| `certified` / `g6` | false |
| Offering refs | form/rules/workflow/evidence/fee/sla/credential/notifications |

Consumed frozen contracts include case SM, workflow, fee, payment, credential, DigiLocker publish, sfpackage manifest (full list in file).

### 2.2 Form (`form.schema.json`)

Schema-driven applicant + residence + declaration fields rendered via UX4G JSON Forms registry. Lab UI may present a wizard (#193 DRAFT polish).

### 2.3 Rules (`rules.gorules.yaml`)

Deterministic nodes: eligibility_check, completeness_check, fee_calculation. No LLM decision node.

### 2.4 Workflow (`workflow.yaml`) — target engine path

| Node | Kind | Notes |
|---|---|---|
| ELIGIBILITY_RULE_GATE / COMPLETENESS_RULE_GATE | RULE_GATE | GoRules |
| DEFICIENCY_NOTICE | DEFICIENCY | max cycles policy |
| FEE_RULE_GATE → PAYMENT | RULE_GATE / PAYMENT | `skip_if_zero_fee` |
| OFFICER_SCRUTINY | HUMAN_TASK | RI-class role (policy) |
| APPROVER_DECISION | HUMAN_TASK | Tahasildar-class; AI forbidden |
| SIGNING → CREDENTIAL_ISSUE → DIGILOCKER_PUBLISH | system | DigiLocker mode from binding |
| Runtime | TEMPORAL | BPMN import/export only |

### 2.5 Fee / SLA

| Policy | LLD |
|---|---|
| Fee | `fee_amount_paisa: 0`; `zero_fee_skip_payment: true` |
| SLA | overall 10 business days; scrutiny/approval 5+5 with deficiency pause |

### 2.6 Fixtures

| File | LLD meaning |
|---|---|
| `tenant-overlay.yaml` | SAMPLE_LAB tenant UUID + pins |
| `tsb-publish-fixture.json` | `publication_state: SAMPLE_LAB_CANDIDATE`; `tsb_immutability_sealed: false` |
| `maker-checker-record.yaml` | Synthetic actor UUIDs only |
| `sfpackage-manifest-fixture.json` | Package manifest candidate |
| `POLICY_INPUT_REQUIRED.md` / `SOURCE_PROVENANCE.md` | Owner input resolution trail |

---

## 3. SAMPLE_LAB journey LLD (tip)

| Concern | Design |
|---|---|
| Citizen route | `apps/web-citizen/app/services/IND-SOC-002/page.tsx` + `ResidenceApplyForm.tsx` |
| Persist | POST `/api/lab/applications` → JSON file store (e.g. `/tmp/sf-m10-ind-soc-002-lab.json`) |
| Officer | `apps/web-officer/app/applications/**` reads same store |
| DigiLocker | `mockDigiLockerPublish` → markers `sim:…` / `SAMPLE_LAB_RESIDENT_CERTIFICATE` |
| Labels | UI must show SAMPLE_LAB / SIMULATED / not G6 |

**Not LLD for G6:** replace lab store with CMP-015 submit + Temporal + CMP-012 connector bound REAL/SANDBOX per env.

---

## 4. DigiLocker connector LLD (CMP-012)

| Aspect | Tip |
|---|---|
| Exported connector | `SimulatedDigiLockerConnector` only |
| Simulation policy | Allowed LOCAL/CI/DEVELOPMENT/SIT/PERFORMANCE with `simulator_version` + marker |
| SANDBOX/REAL HTTP adapter | **Absent** — **G6-HOLD** |
| SAMPLE_LAB doc types in PRODUCTION critical | Refused (`g6-connector-hold.test.ts`) |
| Mode mismatch | Fail closed vs binding |

---

## 5. TSB publish LLD (CMP-052)

1. `POST /v1/tenant-service-bindings/{id}/publish`  
2. Requires CMP-051 approval on `artifact_hash`  
3. Inserts immutable `artifact_version`; marks binding `PUBLISHED`  
4. Outbox: `TenantServiceBindingPublished` + `ArtifactVersionPublished`  
5. DB triggers `prevent_published_*_mutation` → `SF_PUBLISHED_IMMUTABLE`  

G6 fixture keeps `tsb_immutability_sealed: false` until REAL DigiLocker/DLT bindings exist.

---

## 6. Host composition LLD

- M05 plugins register case/workflow HTTP mounts (CMP-016 intentionally not host-HTTP in earlier design notes — verify tip composition before assuming).  
- M10 host evidence: metadata admission only (`evidence/SF-M10-HOST/`).  
- No golden HTTP that claims sealed production publish on tip.

---

## 7. Test harness LLD hooks

| Flag / artifact | Effect |
|---|---|
| `SF_M10_OWNER_INPUTS_READY=1` | Unlocks Odisha-filled INT fixtures |
| `SF_M10_G5_PERF_READY` | Unset → G5 hold PASS refused |
| `SF_M10_RESILIENCE_READY` | Unset → resilience hold |
| `SF_M10_UX4G_READY` | Unset → UX4G journey PASS refused |
| `load-profile.yaml` / `resilience-checklist.yaml` | Schema-only null targets |

Agents MUST NOT invent numbers or set READY flags.

---

## 8. Error / isolation contracts

- Shared error codes: `specs/error-codes.yaml`  
- Isolation declarations: per-CMP `contracts/isolation.*`  
- CDC suites: `tests/cdc/**`  
- Tenant negative: `tests/integration/m10/**`, module `tests/security/m0*`

**Self-score:** LLD **8/10** (golden deep-dive solid; not every CMP fully expanded).
