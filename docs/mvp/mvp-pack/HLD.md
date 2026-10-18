
# HLD — ServiceForm AI MVP (high-level design)

**Document class:** High-Level Design  
**Tip SHA:** `0ceb890e4007242be7b4fd3800c208063b6d7502`  
**CERTIFIED:** false · **G6:** false  

Primary machine-readable HLD: `specs/build-plan.yaml` (v2.5-adr0001) + `specs/component-map.yaml` + `specs/integration-map.yaml`.


## 2. Component landscape (MVP cut)

| Layer | CMPs | Module |
|---|---|---|
| Backbone | 002,003,030–032,036–038,047,048,055 | M01 |
| Identity | 004,005 | M02 |
| Catalogue/Studio/UX | 001,033,034,050–054 | M03 |
| Forms/Rules/Evidence/AI GW | 008,009,011,013,014,039 | M04 |
| Case/Workflow | 015–019,027–029 | M05 |
| Fee/Pay/Notify | 020,021,025,026 | M06 |
| Credential/DigiLocker | 012,022–024 | M07 |
| Discovery/Ops | 006,007,035,045,046,049 | M08 |
| Interop extensions | 056–061 | M09 (parallel to golden metadata) |
| Golden deliverables | templates/fixtures/E2E (no new CMP) | M10 |


## 4. Golden Residence HLD (M10)

| Building block | HLD role | Tip state |
|---|---|---|
| Canonical template | Studio metadata package | `templates/residence-certificate/` SAMPLE_CANDIDATE |
| Tenant overlay | Odisha SAMPLE_LAB pins | `fixtures/golden/ind-soc-002/tenant-overlay.yaml` |
| TSB publish | Immutable pin graph | Fixture `tsb_immutability_sealed: false` |
| E2E harness | Playwright + INT | Journey mock 16 passed; platform path incomplete |
| Policy sample | Owner Finding M-04 | Odisha e-District public facts |
| G5 / resilience / UX4G READY | Release gates | Fail-closed holds |

Planning detail: `docs/planning/CG-03-M09-M10-PLAN.md`, `orchestrator/handovers/M10-PLAN.yaml`.


## 6. Data ownership (high level)

| Concern | Owner | Store |
|---|---|---|
| Authoritative case/credential state | Owning CMP services | PostgreSQL + RLS |
| Workflow durability | Temporal | Temporal store + signals after DB commit |
| AuthZ decisions | OPA | Policy bundles + decision logs |
| Published metadata | CMP-052 | Immutable artifact/binding rows |
| Lab demo state | m10-sample-lab | JSON file — **non-authoritative** |

No cross-component SQL (Constitution).


## 8. Risks & mitigations (design-level)

| Risk | HLD mitigation |
|---|---|
| Lab path confused with platform path | Dual FR sets (FRS-LAB vs FRS-RC); readiness % split |
| Connector inventiveness | INT-013 + fail-closed holds |
| Parallel M09/M10 collisions | CG-03 envelopes; frozen contracts |
| Doc drift | Pack points to SoT YAML/DOCX; pack is secondary |

**Self-score:** HLD **8.5/10** (build-plan/INT graph faithful).
