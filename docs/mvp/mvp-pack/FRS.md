# FRS — ServiceForm AI MVP (functional requirements)

**Document class:** Functional Requirements Specification (synthesized)  
**Focus:** IND-SOC-002 Golden Residence Certificate + platform functions it consumes  
**Tip SHA:** `0ceb890e4007242be7b4fd3800c208063b6d7502`  
**CERTIFIED:** false · **G6:** false · DigiLocker/Payment REAL = **G6-HOLD**

Executable FRs live in `specs/component-map.yaml`, `specs/integration-map.yaml`, OpenAPI, and `templates/residence-certificate/**`. This document organizes them for MVP review.

---

## 1. Actors

| Actor | Functions |
|---|---|
| Applicant (citizen) | Discover service, fill form, upload evidence, submit, view status/credential |
| Scrutiny officer (role) | Review queue, raise deficiency, proceed/reject |
| Approver (role, e.g. Tahasildar class) | Approve/reject; **not** AI |
| Studio configurator | Author metadata, maker-checker publish |
| System engines | Rules, case, workflow, fee, credential, connectors |
| Simulator | DigiLocker/Payment/OTP in LOCAL/CI/SIT |

---

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

---

## 3. Integration functions (INT)

| INT | MVP function | Golden critical? |
|---|---|---|
| INT-001 | Auth → profile → DigiLocker/consent (map spine) | Yes |
| INT-002 | Studio publish → catalogue/TSB | Yes (seal **G6-HOLD**) |
| INT-003 | Discovery → draft application | Yes |
| INT-004 | Submit + outbox | Yes (platform path) |
| INT-005 | Temporal + officer + OPA | Yes (platform path) |
| INT-006 | Evidence chain | Yes |
| INT-007 | Fee/payment | Yes (₹0 skip SAMPLE_LAB) |
| INT-008 | Credential/QR/DigiLocker | Yes (**SIMULATED**; REAL **G6-HOLD**) |
| INT-009 | Deficiency/SLA | Yes |
| INT-011 | Tenant isolation | Cross-cutting |
| INT-013 | Connector modes REAL/SANDBOX/SIMULATED | Cross-cutting |

---

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

---

## 5. SAMPLE_LAB journey FRs (tip demo — not G6)

| FR | Behavior | Implementation note |
|---|---|---|
| FRS-LAB-01 | Citizen opens `/services/IND-SOC-002` and submits application | `apps/web-citizen` |
| FRS-LAB-02 | Persistence via lab JSON store API | `@serviceform/m10-sample-lab` — **not** CMP-015 |
| FRS-LAB-03 | Officer lists/reviews/approves/rejects | `apps/web-officer` |
| FRS-LAB-04 | DigiLocker publish button uses SIMULATED mock markers | `CertificateDetail` / mock publish |
| FRS-LAB-05 | Screens/evidence labeled SAMPLE_LAB / SIMULATED / G6=false | UI + `evidence/SF-M10-JOURNEY-MOCK/` |

**Gap to platform FRs:** FRS-LAB-* satisfy demo; G6 requires FRS-RC-* executed through CMP/INT engines with REAL DigiLocker where critical.

---

## 6. Explicit non-functions

| Item | Status |
|---|---|
| LLM final approve/reject | Forbidden |
| Invented Act citations | Forbidden |
| REAL DigiLocker without credentials | **G6-HOLD** |
| REAL Payment for general path | **held** |
| Claiming CERTIFIED/G6 | Forbidden for agents |

---

## 7. Acceptance mapping

| FR group | Demo evidence | Release evidence |
|---|---|---|
| FRS-LAB-* | Golden E2E 16 passed | N/A (must retire for G6) |
| FRS-RC-* metadata | Odisha sample + template on tip | Sealed TSB publish |
| INT-008 DigiLocker | SIMULATED unit/lab | REAL connector evidence |
| INT-011 | Harness 24/6 todo | Full release isolation suite |

**Self-score:** FRS **8/10** (strong metadata/INT mapping; platform-path vs lab split explicit).
