# MVP documentation pack — index

**For:** Debabrata Nayak  
**Tip SHA:** `0ceb890e4007242be7b4fd3800c208063b6d7502` (`origin/main`)  
**Pack date:** 2026-10-18  
**CERTIFIED:** false · **G6:** false · DigiLocker/Payment REAL: **G6-HOLD**

| Score lens | Value | Notes |
|---|---:|---|
| **Author self-score (pre-review)** | **8/10** | Classic set present; REQ registry + signed BRD open |
| **Independent review (final)** | **8.5/10** | See [`mvp-docs-independent-review.md`](./mvp-docs-independent-review.md) — PR truncation + TEST-CASES remap fixed; CERTIFIED/G6 still false |
| **Demo readiness** | **~58%** | See [`mvp-readiness.md`](./mvp-readiness.md) |
| **G6 release readiness** | **~3%** | Holds unchanged |

This pack **synthesizes** existing authoritative sources. It does not invent statute or claim CERTIFIED/G6.

**Independent review:** [`mvp-docs-independent-review.md`](./mvp-docs-independent-review.md) (reviewer `bc-05195482-8d4e-5b9d-8549-1db51a400411`) — **not** a rubber stamp; P0 PR truncation and E2E catalogue defects recorded and fixed.

---

## 1. Pack files (Project store)

| Classic doc | Store path | Author self | Independent final |
|---|---|---:|---:|
| Readiness scorecard | [`mvp-readiness.md`](./mvp-readiness.md) | 8.5 | **9.0** |
| **BRD** | [`mvp-pack/BRD.md`](./mvp-pack/BRD.md) | 8 | **8.5** |
| **SRS** | [`mvp-pack/SRS.md`](./mvp-pack/SRS.md) | 7.5 | **7.5** |
| **FRS** | [`mvp-pack/FRS.md`](./mvp-pack/FRS.md) | 8 | **8.5** |
| **SDD** | [`mvp-pack/SDD.md`](./mvp-pack/SDD.md) | 8 | **8.5** |
| **HLD** | [`mvp-pack/HLD.md`](./mvp-pack/HLD.md) | 8.5 | **9.0** |
| **LLD** | [`mvp-pack/LLD.md`](./mvp-pack/LLD.md) | 8 | **8.5** |
| **Test cases** | [`mvp-pack/TEST-CASES.md`](./mvp-pack/TEST-CASES.md) | 7.5 | **8.5** |
| Independent review | [`mvp-docs-independent-review.md`](./mvp-docs-independent-review.md) | — | deliverable |

Internal inventories (worker scratch):  
[`../internal/mvp-classic-docs-inventory.md`](../internal/mvp-classic-docs-inventory.md) · [`../internal/mvp-readiness-scorecard-0ceb890.md`](../internal/mvp-readiness-scorecard-0ceb890.md)

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
| Traceability declaration | `TRACEABILITY.md` (`specs/requirements/` still **missing**) |

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
| Evidence | `evidence/SF-M10-*` (incl. `SF-M10-JOURNEY-MOCK`) |
| E2E / INT | `tests/e2e/golden/ind-soc-002-golden.spec.ts`, `tests/integration/m10/**` |

**SoT caveat:** `M10-G6-PREREQUISITES.md` still says journey E2E=false (pre-#186). Tip SAMPLE_LAB journey is **16 passed**; platform-path / G6 still HOLD.

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
| Independent doc review | **Done** — [`mvp-docs-independent-review.md`](./mvp-docs-independent-review.md); overall **8.5/10** |
| Visual regression baselines | Tooling absent |
| Tip refresh of M10 G6 prereq/recommendation narrative for #186 | Recommended follow-up (separate) |

---

## 4. Independent review handoff checklist

Reviewer should verify and tick (agents do not self-certify):

- [x] Tip SHA still `0ceb890…` or re-score if tip moved  
- [x] Pack statements match `ARCHITECTURE-CONSTITUTION.md` / ADRs (no invented statute)  
- [x] SAMPLE_LAB / SIMULATED / G6-HOLD labels consistent across BRD→TEST-CASES  
- [x] DigiLocker REAL and Payment REAL documented as holds (not inventable)  
- [x] Demo % (~58%) vs G6 % (~3%) treated as separate; no CERTIFIED claim  
- [x] Repo SoT links resolve; pack defers to DOCX/YAML on conflict  
- [x] Test catalogue maps to real files under `tests/` + `evidence/SF-M10-*`  
- [x] DRAFT PR `docs/mvp/` is docs-only; **re-check CI after sync push**  
- [x] Recommend merge vs revise; do **not** issue G6 — **revise-then-merge when CI green**  
- [ ] After accept, close tracker item “Independent doc review — after pack lands”

Target reviewer outcome: pack quality **8.5/10** post-fix; **10/10 impossible** without signed BRD, REQ registry, and G6 execution evidence (see review §5).

---

## 5. PR / delivery

| Item | Value |
|---|---|
| Store deliverables | Paths in §1 + independent review |
| Repo mirror | `docs/mvp/` + `docs/mvp/mvp-pack/` (+ review file) |
| DRAFT PR | [#194](https://github.com/dbn1972/serviceform-ai/pull/194) · branch `cursor/mvp-documentation-pack-f8c1` @ `ae6802f` (review sync) |
| Merge preference | Prefer DRAFT until CI green on post-review sync; docs-only; **no G6** |

---

## 6. Quick narrative for Debabrata

Platform exits through **M09** are recorded. M10 has an honest **SAMPLE_LAB** Residence Certificate walkthrough (apply → approve → DigiLocker **SIMULATED**) with Odisha public portal facts — **not** G6. Documentation pack exists as classic BRD→tests with SoT links. Independent review scored **8.5/10** after fixing PR truncation and test-catalogue mapping; **CERTIFIED/G6 remain false**. Next human gates: merge docs when CI green, then (separately) REAL DigiLocker/PERF/resilience/UX4G/TSB for any G6 conversation.
