
# LLD — ServiceForm AI MVP (low-level design)

**Document class:** Low-Level Design (golden slice + critical seams)  
**Tip SHA:** `0ceb890e4007242be7b4fd3800c208063b6d7502`  
**CERTIFIED:** false · **G6:** false · DigiLocker/Payment REAL = **G6-HOLD**

Per-CMP LLD remains in OpenAPI/AsyncAPI/migrations/READMEs. This document deep-dives the MVP golden slice.


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


## 4. DigiLocker connector LLD (CMP-012)

| Aspect | Tip |
|---|---|
| Exported connector | `SimulatedDigiLockerConnector` only |
| Simulation policy | Allowed LOCAL/CI/DEVELOPMENT/SIT/PERFORMANCE with `simulator_version` + marker |
| SANDBOX/REAL HTTP adapter | **Absent** — **G6-HOLD** |
| SAMPLE_LAB doc types in PRODUCTION critical | Refused (`g6-connector-hold.test.ts`) |
| Mode mismatch | Fail closed vs binding |


## 6. Host composition LLD

- M05 plugins register case/workflow HTTP mounts (CMP-016 intentionally not host-HTTP in earlier design notes — verify tip composition before assuming).  
- M10 host evidence: metadata admission only (`evidence/SF-M10-HOST/`).  
- No golden HTTP that claims sealed production publish on tip.


## 8. Error / isolation contracts

- Shared error codes: `specs/error-codes.yaml`  
- Isolation declarations: per-CMP `contracts/isolation.*`  
- CDC suites: `tests/cdc/**`  
- Tenant negative: `tests/integration/m10/**`, module `tests/security/m0*`

**Self-score:** LLD **8/10** (golden deep-dive solid; not every CMP fully expanded).
