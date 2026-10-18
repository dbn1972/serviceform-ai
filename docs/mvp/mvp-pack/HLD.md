# HLD — ServiceForm AI MVP (high-level design)

**Document class:** High-Level Design  
**Tip SHA:** `0ceb890e4007242be7b4fd3800c208063b6d7502`  
**CERTIFIED:** false · **G6:** false  

Primary machine-readable HLD: `specs/build-plan.yaml` (v2.5-adr0001) + `specs/component-map.yaml` + `specs/integration-map.yaml`.

---

## 1. Module graph (M00–M12)

```text
M00 Bootstrap
  └─ M01 Foundation/Security (G4) ──┬── M02 Identity (G3)
                                    └── M03 Catalogue/Studio/UX4G (G3)
                                          └─ M04 Forms/Rules/Evidence/AI (G3)
                                                └─ M05 Case/Workflow (G4)
                                                      ├── M06 Fees/Pay/Notify (G3) ── M07 Credentials/DigiLocker (G3)
                                                      └── M08 Search/Analytics (G3)
                                                            └─ CG-03: M09 Interop (G4) ∥ M10 Golden (G6) ← HOLD
                                                                  └─ CG-04: M11 Reuse ∥ M12 AI Assist
```

| Concurrency group | After | Parallel |
|---|---|---|
| CG-01 | M01 | M02 ∥ M03 |
| CG-02 | M05 | M06 ∥ M08 |
| CG-03 | M07+M08 | M09 ∥ M10 |
| CG-04 | M10 | M11 ∥ M12 |

**Tip status:** M01–M09 exits issued; M10 G6 **HOLD**; M11/M12 not started.

---

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

---

## 3. Integration landscape (golden spine)

```text
INT-001 Auth/Profile
   → INT-003 Discovery→Draft
   → INT-004 Submit/Outbox
   → INT-005 Temporal/Officer/OPA
   → INT-006 Evidence
   → INT-007 Fee/Payment (₹0 skip SAMPLE_LAB)
   → INT-008 Credential/QR/DigiLocker (SIMULATED tip / REAL G6-HOLD)
INT-002 Studio publish (TSB seal G6-HOLD)
INT-009 Deficiency/SLA
INT-011 Tenant isolation (every exit)
INT-013 Connector modes
```

---

## 4. Golden Residence HLD (M10)

| Building block | HLD role | Tip state |
|---|---|---|
| Canonical template | Studio metadata package | `templates/residence-certificate/` SAMPLE_CANDIDATE |
| Tenant overlay | Odisha SAMPLE_LAB pins | `fixtures/golden/ind-soc-002/tenant-overlay.yaml` |
| TSB publish | Immutable pin graph | Fixture `tsb_immutability_sealed: false` |
| E2E harness | Playwright + INT | Journey mock **16 passed** (`evidence/SF-M10-JOURNEY-MOCK/`); platform-path E2E still incomplete. Note: `M10-G6-PREREQUISITES.md` still says “journey E2E=false” from pre-#186 tip — treat SAMPLE_LAB journey as present, platform path as not G6 |
| Policy sample | Owner Finding M-04 | Odisha e-District public facts |
| G5 / resilience / UX4G READY | Release gates | Fail-closed holds |

Planning detail: `docs/planning/CG-03-M09-M10-PLAN.md`, `orchestrator/handovers/M10-PLAN.yaml`.

---

## 5. Application surfaces (HLD)

| App | HLD responsibility | Tip maturity |
|---|---|---|
| `web-citizen` | Apply, status, credentials | SAMPLE_LAB journey present |
| `web-officer` | Queue, scrutiny, decision | SAMPLE_LAB journey present |
| `web-studio` | Metadata + publication | Partial product shells |
| `web-admin` | Bindings/branding/reviews | Partial |
| `mobile` | Flutter citizen | Bootstrap |
| `apps/api` | Host composition | M05+ plugins; M10 metadata admission |

---

## 6. Data ownership (high level)

| Concern | Owner | Store |
|---|---|---|
| Authoritative case/credential state | Owning CMP services | PostgreSQL + RLS |
| Workflow durability | Temporal | Temporal store + signals after DB commit |
| AuthZ decisions | OPA | Policy bundles + decision logs |
| Published metadata | CMP-052 | Immutable artifact/binding rows |
| Lab demo state | m10-sample-lab | JSON file — **non-authoritative** |

No cross-component SQL (Constitution).

---

## 7. Release HLD (G6)

Human `G6_RELEASE_CERTIFIED` requires (see `M10-G6-PREREQUISITES.md` + tip #186 update):

1. Platform-path golden E2E (retire lab store as G6 evidence) + tenant isolation  
2. G5 PERF numbers + cell  
3. Resilience/backup/restore/rollback  
4. REAL DigiLocker for production critical  
5. UX4G journey READY (`SF_M10_UX4G_READY`)  
6. TSB immutability seal  
7. Payment REAL when fee > 0 (Odisha ₹0 lab skip OK; general path held)  
8. Independent EVD re-bind + human issuance  

**None of the above authorize agents to claim G6.**

---

## 8. Risks & mitigations (design-level)

| Risk | HLD mitigation |
|---|---|
| Lab path confused with platform path | Dual FR sets (FRS-LAB vs FRS-RC); readiness % split |
| Connector inventiveness | INT-013 + fail-closed holds |
| Parallel M09/M10 collisions | CG-03 envelopes; frozen contracts |
| Doc drift | Pack points to SoT YAML/DOCX; pack is secondary |

**Self-score:** HLD **8.5/10** (build-plan/INT graph faithful).
