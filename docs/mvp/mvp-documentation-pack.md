# MVP documentation pack — index

**For:** Debabrata Nayak  
**Tip SHA:** `0ceb890e4007242be7b4fd3800c208063b6d7502` (`origin/main`)  
**Pack date:** 2026-10-18  
**CERTIFIED:** false · **G6:** false · DigiLocker/Payment REAL: **G6-HOLD**

| Self-score | Value | Notes |
|---|---:|---|
| **Doc completeness** | **8/10** | Classic set present; REQ registry + signed BRD + independent review still open |
| **Demo readiness** | **~58%** | See [`mvp-readiness.md`](./mvp-readiness.md) |
| **G6 release readiness** | **~3%** | Holds unchanged |

This pack **synthesizes** existing authoritative sources. It does not invent statute or claim CERTIFIED/G6.

---

## 1. Pack files (this folder)

| Classic doc | Path | Self-score |
|---|---|---:|
| Readiness scorecard | [`mvp-readiness.md`](./mvp-readiness.md) | 8.5/10 |
| **BRD** | [`mvp-pack/BRD.md`](./mvp-pack/BRD.md) | 8/10 |
| **SRS** | [`mvp-pack/SRS.md`](./mvp-pack/SRS.md) | 7.5/10 |
| **FRS** | [`mvp-pack/FRS.md`](./mvp-pack/FRS.md) | 8/10 |
| **SDD** | [`mvp-pack/SDD.md`](./mvp-pack/SDD.md) | 8/10 |
| **HLD** | [`mvp-pack/HLD.md`](./mvp-pack/HLD.md) | 8.5/10 |
| **LLD** | [`mvp-pack/LLD.md`](./mvp-pack/LLD.md) | 8/10 |
| **Test cases** | [`mvp-pack/TEST-CASES.md`](./mvp-pack/TEST-CASES.md) | 7.5/10 |

---

## 2. Repo SoT map (existing — prefer these over pack when conflict)

### Authoritative / governance

| Role | Repo path |
|---|---|
| Normative order | `00_READ_FIRST.md` |
| Constitution | `ARCHITECTURE-CONSTITUTION.md` |
| Agent rules | `AGENTS.md` |
| Build sequence | `specs/build-plan.yaml` |
| CMP / INT maps | `specs/component-map.yaml`, `specs/integration-map.yaml` |
| AWS FTS | `docs/authoritative/ServiceForm_AI_Component_Functional_Technical_Specification_AWS_v1.7.docx` |
| Eng BB | `docs/authoritative/ServiceForm_AI_Building_Block_Engineering_Specifications_v1.4.docx` |
| Tenant isolation | `docs/authoritative/ServiceForm_AI_Tenant_Isolation_Architecture_v1.0.docx` |
| ADRs | `docs/adr/ADR-0001`…`ADR-0006` |
| UX4G | `DESIGN-SYSTEM.md`, `specs/design-system.yaml` |
| Service model | `SERVICE-MODEL.md` |
| Testing / security / AI | `TESTING.md`, `SECURITY.md`, `AI-GOVERNANCE.md`, `TENANCY.md` |

### Golden Residence (IND-SOC-002)

| Role | Repo path |
|---|---|
| Template metadata | `templates/residence-certificate/**` |
| Fixtures / provenance | `fixtures/golden/ind-soc-002/**` |
| Service package | `packages/service-packages/ind-soc-002/**` |
| Golden prompt | `prompts/03_GOLDEN_RESIDENCE_CERTIFICATE.md` |
| Catalogue | `docs/catalogue/*` |
| M10 planning | `docs/planning/CG-03-M09-M10-*.md` |
| G6 holds | `docs/verification/M10-G6-PREREQUISITES.md`, `M10-G6-RECOMMENDATION.md` |
| Evidence | `evidence/SF-M10-*` |
| E2E / INT | `tests/e2e/golden/ind-soc-002-golden.spec.ts`, `tests/integration/m10/**` |

### Module gate records

`docs/verification/M01-G4-EXIT.md`, `M02`…`M09` `*-GATE-RECORD.md` / recommendations — all **CERTIFIED/G6 false**.

### Classic-named docs in repo before this pack

**None** (no BRD/SRS/FRS/SDD/HLD/LLD filenames). `docs/mvp/` did not exist; DRAFT PR mirrors this pack under `docs/mvp/` for human review.

---

## 3. Gaps inventory (honest)

| Gap | Status |
|---|---|
| Stakeholder-signed BRD | Missing — pack BRD is synthesized |
| `specs/requirements/` REQ ID registry | Missing (TRACEABILITY.md declares it) |
| `tests/traceability/requirements-tests.yaml` | Missing |
| Platform-path golden E2E (vs lab store) | Incomplete — SAMPLE_LAB only |
| DigiLocker REAL | **G6-HOLD** |
| Payment REAL | **held** (₹0 lab OK) |
| G5 / resilience / UX4G READY | **G6-HOLD** |
| TSB immutability seal | **G6-HOLD** |
| Independent doc review | Pending (see checklist) |
| Visual regression baselines | Tooling absent |

---

## 4. Independent review handoff checklist

Reviewer should verify and tick (agents do not self-certify):

- [ ] Tip SHA still `0ceb890…` or re-score if tip moved  
- [ ] Pack statements match `ARCHITECTURE-CONSTITUTION.md` / ADRs (no invented statute)  
- [ ] SAMPLE_LAB / SIMULATED / G6-HOLD labels consistent across BRD→TEST-CASES  
- [ ] DigiLocker REAL and Payment REAL documented as holds (not inventable)  
- [ ] Demo % (~58%) vs G6 % (~3%) treated as separate; no CERTIFIED claim  
- [ ] Repo SoT links resolve; pack defers to DOCX/YAML on conflict  
- [ ] Test catalogue maps to real files under `tests/` + `evidence/SF-M10-*`  
- [ ] DRAFT PR `docs/mvp/` (if open) is docs-only; CI green before merge  
- [ ] Recommend merge vs revise; do **not** issue G6  
- [ ] After accept, close tracker item “Independent doc review — after pack lands”

Target reviewer outcome: upgrade pack completeness toward **10/10** only after the above.

---

## 5. PR / delivery

| Item | Value |
|---|---|
| Store deliverables | Paths in §1 |
| Repo mirror | `docs/mvp/` + `docs/mvp/mvp-pack/` (DRAFT PR) |
| Merge preference | Prefer DRAFT until independent review; docs-only risk low if CI green |

---

## 6. Quick narrative for Debabrata

Platform exits through **M09** are recorded. M10 has an honest **SAMPLE_LAB** Residence Certificate walkthrough (apply → approve → DigiLocker **SIMULATED**) with Odisha public portal facts — **not** G6. Documentation pack now exists as classic BRD→tests with full SoT links. Next human gates: independent doc review, then (separately) REAL DigiLocker/PERF/resilience/UX4G/TSB for any G6 conversation.
