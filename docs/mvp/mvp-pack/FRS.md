
# FRS — ServiceForm AI MVP (functional requirements)

**Document class:** Functional Requirements Specification (synthesized)  
**Focus:** IND-SOC-002 Golden Residence Certificate + platform functions it consumes  
**Tip SHA:** `0ceb890e4007242be7b4fd3800c208063b6d7502`  
**CERTIFIED:** false · **G6:** false · DigiLocker/Payment REAL = **G6-HOLD**

Executable FRs live in `specs/component-map.yaml`, `specs/integration-map.yaml`, OpenAPI, and `templates/residence-certificate/**`. This document organizes them for MVP review.


## 2. Platform functional catalogue (by CMP)

### Foundation & Studio (selected)

| CMP | Function (MVP-relevant) |
|---|---|
| CMP-001 Catalogue | Canonical service/offering identity including IND-SOC-002 |
| CMP-002/003 Tenant & org | Tenant resolution, org hierarchy |
| CMP-031/032 AuthZ | OPA decision + policy pinning |
| CMP-050–053 Studio/versioning | Metadata authoring, approval, publish |
| CMP-052 Versioning/TSB | Pin graph + immutable published binding |
| CMP-054 UX4G | Design-system components/tokens |

### Citizen path engines

| CMP | Function |
|---|---|
| CMP-004/005 Identity/profile | AuthN + citizen claims |
| CMP-008 Forms | Schema-driven capture |
| CMP-009 Rules | GoRules eligibility/completeness/fee |
| CMP-011/013/014 Evidence | Upload, intelligence assist, technical accept |
| CMP-015–019 / 027–029 Case path | Application, case, workflow adapter, tasks, verification, deficiency, SLA, grievance/appeal |
| CMP-020/021 Fee/payment | Quote + PSP (**REAL held**) |
| CMP-025/026 Notify/message | Status notifications (**SIMULATED lab OK**) |
| CMP-012/022–024 Credential path | DigiLocker (**SIMULATED on tip**), credential, QR, registry |

Full CMP-001…061 list: `specs/component-map.yaml`.


## 4. IND-SOC-002 service-level FRs (metadata)

From `templates/residence-certificate/` + Odisha sample fixtures:

| FR | Behavior | Artifact |
|---|---|---|
| FRS-RC-01 | Catalogue id `IND-SOC-002`, status `SAMPLE_CANDIDATE` | `service.yaml` |
| FRS-RC-02 | Eligibility: ≥12 months residence in Tahasil (+ portal relaxations) | `rules.gorules.yaml` + policy fixtures |
| FRS-RC-03 | Form captures applicant + residence + declaration | `form.schema.json` |
| FRS-RC-04 | Evidence: any one/more of portal document list | `evidence-policy.yaml` |
| FRS-RC-05 | Fee ₹0; `zero_fee_skip_payment: true` | `fee-policy.yaml` |
| FRS-RC-06 | Overall SLA 10 working days from APPLICATION_SUBMITTED | `sla-policy.yaml` |
| FRS-RC-07 | Workflow: rule gates → (payment skip) → scrutiny → approval → signing → credential | `workflow.yaml` |
| FRS-RC-08 | Credential template SAMPLE_LAB id | `credential-template.yaml` |
| FRS-RC-09 | Notifications SAMPLE_LAB template ids | `notifications.yaml` |
| FRS-RC-10 | Access: citizen portal, assisted, mobile; consent required | `access-policy.yaml` / `service.yaml` |
| FRS-RC-11 | Maker-checker roles: RI-class scrutiny → Tahasildar approval → system issuance | `service.yaml` |
| FRS-RC-12 | DigiLocker doc type SAMPLE_LAB — refused for PRODUCTION critical | fixtures + `g6-connector-hold` |


## 6. Explicit non-functions

| Item | Status |
|---|---|
| LLM final approve/reject | Forbidden |
| Invented Act citations | Forbidden |
| REAL DigiLocker without credentials | **G6-HOLD** |
| REAL Payment for general path | **held** |
| Claiming CERTIFIED/G6 | Forbidden for agents |

