
# BRD — ServiceForm AI MVP (Golden Residence Certificate)

**Document class:** Business Requirements Document (synthesized)  
**Status:** SAMPLE_LAB / draft for human review — **not** stakeholder-signed  
**Tip SHA:** `0ceb890e4007242be7b4fd3800c208063b6d7502`  
**CERTIFIED:** false · **G6:** false  

This BRD consolidates existing authoritative business sources. It does **not** invent statutory policy. Where Odisha portal facts are used, they are labeled SAMPLE_LAB pilot inputs (Finding M-04).


## 2. Stakeholders

| Role | Interest |
|---|---|
| Platform owner (Debabrata Nayak / program) | Architecture fidelity, reuse proof, certification gates |
| Pilot line department (SAMPLE_LAB: Odisha R&DM framing) | Correct eligibility/fee/SLA/evidence as published |
| Citizens / applicants | Discoverable service, clear evidence, status, credential |
| Scrutiny / approval officers (role-based, no named officers) | Work queue, deficiency, approve/reject with audit |
| Security / tenancy reviewers | FORCE RLS, OPA, INT-011 isolation |
| Independent verifiers | Evidence packs; agents cannot self-certify |


## 4. Scope

### In scope (MVP program)

| ID | Business capability | Trace |
|---|---|---|
| BR-01 | Catalogue identity for Residence Certificate | `IND-SOC-002`; `docs/catalogue/*` |
| BR-02 | Metadata template + tenant overlay | M10; `templates/residence-certificate/**` |
| BR-03 | TenantServiceBinding publish model (immutable after publish) | CMP-052; INT-002 |
| BR-04 | Citizen apply / officer decide / credential path | INT-003…008; M05–M07 |
| BR-05 | Deterministic eligibility/fee rules (no LLM statutory decision) | CMP-009 GoRules; Constitution §20 |
| BR-06 | Tenant isolation as business risk control | INT-011; TI v1.0 |
| BR-07 | External connectors with SIMULATED/SANDBOX/REAL modes | INT-013; DigiLocker CMP-012; Payment CMP-021 |
| BR-08 | UX4G citizen/officer/studio surfaces | CMP-054; DESIGN-SYSTEM.md |

### Out of scope / G6-HOLD

| ID | Hold | Reason |
|---|---|---|
| BR-H1 | DigiLocker **REAL** production publish | Registrar credentials + registered doc type inventable ≠ available |
| BR-H2 | Payment **REAL** PSP | Deferred M06 residual; Odisha fee ₹0 allows lab skip |
| BR-H3 | Human `G6_RELEASE_CERTIFIED` | Prerequisites in `docs/verification/M10-G6-PREREQUISITES.md` |
| BR-H4 | Second-service production reuse (M11) | Depends on M10 G6 decision |
| BR-H5 | AI assistants as decision makers (M12) | Assistance only; never statutory approve/reject |


## 6. Golden service business facts (SAMPLE_LAB)

**Source:** Odisha e-District public Resident Certificate — https://edistrict.odisha.gov.in/  
**Provenance:** `fixtures/golden/ind-soc-002/SOURCE_PROVENANCE.md`  
**Resolved inputs:** `POLICY_INPUT_REQUIRED.md`

| Business fact | Value | Label |
|---|---|---|
| Pilot state | `IN-OD` | SAMPLE_LAB |
| Eligibility | ≥1 year continuous residence in concerned Tahasil (+ published relaxations) | Public portal |
| Fee | ₹0 government service charge | Public portal |
| SLA | 10 working days | Public portal |
| Evidence | Portal “any one/more” document list | Public portal |
| Issuing authority class | Tahasildar | Public portal |
| DigiLocker doc type | `SAMPLE_LAB_*` | **Not** portal-published — lab only |
| DLT / SMS PE-ID | `SAMPLE_LAB_*` | Lab only |

**Forbidden:** Inventing Act section numbers, real officer names, real PII, or claiming DigiLocker registration.


## 8. Risks (business)

| Risk | Mitigation on tip |
|---|---|
| Demo mistaken for production | UI + evidence banners: SAMPLE_LAB / SIMULATED / G6=false |
| Policy drift vs statute | Fail-closed when owner inputs missing; no LLM final decisions |
| Connector credential delay | Explicit G6-HOLD; SIMULATED allowed only non-prod per INT-013 |
| Scope creep into bespoke service code | Constitution §1; M11 reuse rule |


## 10. Source map (do not duplicate conflicting text)

| Source | Role |
|---|---|
| `SERVICE-MODEL.md`, `DOMAIN-GLOSSARY.md` | Business object model |
| `docs/catalogue/*` | Canonical service identity |
| `fixtures/golden/ind-soc-002/*` | Pilot business facts |
| `docs/authoritative/*.docx` | Authoritative product/engineering BRD-class content |
| `prompts/03_GOLDEN_RESIDENCE_CERTIFICATE.md` | Golden acceptance narrative |

**Self-score:** BRD substance **8/10** (synthesized; not signed by business stakeholders).
