
# SRS — ServiceForm AI MVP (system requirements)

**Document class:** Software / System Requirements Specification (synthesized)  
**Status:** Draft for human review · SAMPLE_LAB where noted  
**Tip SHA:** `0ceb890e4007242be7b4fd3800c208063b6d7502`  
**CERTIFIED:** false · **G6:** false  

Normative precedence: ADRs → `ARCHITECTURE-CONSTITUTION.md` → authoritative DOCX → this pack.  
REQ IDs below are **pack-local** (TRACEABILITY.md’s `specs/requirements/` directory is still missing on tip).


## 2. Functional requirement groups

### 2.1 Platform foundation (M01–M03)

| REQ | Statement | Trace |
|---|---|---|
| SRS-F-001 | System SHALL enforce tenant context on every request (INT-011). | CMP-002/003; TI v1.0 |
| SRS-F-002 | System SHALL use Aurora PostgreSQL with FORCE RLS as authoritative state. | Constitution; CMP-047 |
| SRS-F-003 | System SHALL evaluate authorization via OPA; no ad-hoc bypass. | CMP-031/032 |
| SRS-F-004 | System SHALL support catalogue offerings and TenantServiceBinding publish with immutability after publish. | CMP-001, CMP-050–052; INT-002 |
| SRS-F-005 | UI SHALL follow UX4G Design System 3.0 (no alternate DS without ADR). | CMP-054; DESIGN-SYSTEM.md |

### 2.2 Identity, forms, case, workflow (M02–M05)

| REQ | Statement | Trace |
|---|---|---|
| SRS-F-010 | Citizen identity/profile path SHALL support SIMULATED/SANDBOX OTP in non-prod. | CMP-004/005; INT-001 |
| SRS-F-011 | Forms SHALL be schema-driven with UX4G renderers. | CMP-008; JSON Forms |
| SRS-F-012 | Business rules SHALL be deterministic (GoRules); LLM SHALL NOT issue final eligibility/approval. | CMP-009; AI-GOVERNANCE |
| SRS-F-013 | Evidence upload SHALL separate technical acceptance from business verification. | CMP-011/013/014; INT-006 |
| SRS-F-014 | Application/case engines SHALL commit durable state before Temporal signals. | CMP-015–017; INT-004/005 |
| SRS-F-015 | Human tasks SHALL assign by role+org+jurisdiction — never hard-coded officer names. | CMP-018; Constitution §19 |
| SRS-F-016 | Deficiency and SLA clocks SHALL pause/resume per published policy. | CMP-019/027–029; INT-009 |

### 2.3 Fees, notifications, credentials (M06–M07)

| REQ | Statement | Trace |
|---|---|---|
| SRS-F-020 | Fee quote SHALL precede payment; zero-fee MAY skip PSP. | CMP-020; INT-007 |
| SRS-F-021 | Payment connector SHALL support SIMULATED/SANDBOX/REAL per INT-013; **REAL = G6-HOLD**. | CMP-021 |
| SRS-F-022 | Notifications/messaging SHALL support SIMULATED sinks in lab. | CMP-025/026 |
| SRS-F-023 | Credential issuance path APPROVED → SIGNING_PENDING → ISSUED → CLOSED. | CMP-022–024; Constitution §18 |
| SRS-F-024 | DigiLocker publish SHALL require mode match binding; PRODUCTION critical needs REAL; **REAL = G6-HOLD**. | CMP-012; INT-008/013 |

### 2.4 Golden Residence (M10)

| REQ | Statement | Trace |
|---|---|---|
| SRS-F-030 | System SHALL provide IND-SOC-002 template + tenant overlay + TSB fixture. | `templates/`, `fixtures/golden/ind-soc-002/` |
| SRS-F-031 | SAMPLE_LAB journey SHALL demonstrate apply → approve → DigiLocker SIMULATED without claiming G6. | #186; `evidence/SF-M10-JOURNEY-MOCK/` |
| SRS-F-032 | Platform-path golden E2E SHALL fail closed until owner/REAL prerequisites met. | `M10-G6-PREREQUISITES.md` |
| SRS-F-033 | Odisha portal facts (eligibility/fee/SLA/evidence) SHALL be used only as labeled SAMPLE_LAB inputs. | `SOURCE_PROVENANCE.md` |


## 4. External interface requirements

| Interface | Mode on tip | Release mode |
|---|---|---|
| DigiLocker | SIMULATED only (CMP-012) | REAL for PRODUCTION critical — **G6-HOLD** |
| Payment PSP | SIMULATED; ₹0 skip for Odisha sample | REAL when fee > 0 — **held** |
| SMS/Email | SIMULATED / SAMPLE_LAB templates | Provider + DLT PE-ID when required |
| OPA / Temporal / PostgreSQL | Local/CI harnesses | Deployed cells per env |


## 6. Acceptance (system-level)

| Gate | Meaning | MVP tip status |
|---|---|---|
| Module G3/G4 | Module exit | M01–M09 issued |
| G5 | Performance | **HOLD** |
| G6 | Release certified | **HOLD** (`G6_ISSUED=false`) |

Demo acceptance ≠ G6 acceptance. See [`../mvp-readiness.md`](../mvp-readiness.md).

