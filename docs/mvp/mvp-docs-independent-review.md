# Independent review — ServiceForm AI MVP documentation pack

**Reviewer role:** Independent (not pack author)  
**Author pack agent:** `bc-bd901fb4-83fa-5b50-93b9-9c19d0f4f8c1`  
**Tip verified:** `0ceb890e4007242be7b4fd3800c208063b6d7502` (`origin/main`, merge #186)  
**Review date:** 2026-10-18  
**DRAFT PR reviewed:** [#194](https://github.com/dbn1972/serviceform-ai/pull/194) @ `4becf3f` (pre-fix) → post-fix sync `ebace7b` on `cursor/mvp-documentation-pack-f8c1`  

**Explicit:** **CERTIFIED = false** · **G6 = false** · DigiLocker REAL = **G6-HOLD** · Payment REAL = **held** · `self_certified = false` · This review does **not** issue any gate.

Cross-checks: `ARCHITECTURE-CONSTITUTION.md`, `AGENTS.md`, `specs/build-plan.yaml`, `specs/component-map.yaml`, `specs/integration-map.yaml`, `docs/verification/M10-G6-PREREQUISITES.md`, `M10-G6-RECOMMENDATION.md`, `TRACEABILITY.md`, `evidence/SF-M10-*`, `tests/e2e/golden/ind-soc-002-golden.spec.ts`, template/fixture paths.

---

## 1. Scores

### 1.1 Initial scores (store pack as authored — before reviewer edits)

| Document | Author self-score | Independent initial | Rationale (evidence) |
|---|---:|---:|---|
| Readiness | 8.5 | **8.5** | Honest ~58% / ~28% / ~3% split; tip SHA; module gates; G6 holds; methodology table. Minor: did not flag `M10-G6-PREREQUISITES.md` stale “journey E2E=false” vs #186. |
| BRD | 8 | **7.5** | Strong SAMPLE_LAB / non-claims; BR-* IDs; SoT map. Unsigned; BR-H1 wording garbled (“inventable ≠ available”). |
| SRS | 7.5 | **7.0** | Pack-local REQs + Constitution alignment; holds correct. Thin vs AWS v1.7 DOCX; `specs/requirements/` absent (TRACEABILITY.md declares it). |
| FRS | 8 | **8.0** | Excellent FRS-LAB vs FRS-RC split; CMP/INT tables; tip lab honesty. INT-001 oversimplified vs integration-map. |
| SDD | 8 | **8.0** | Separation of concerns matches Constitution §7; lab deviation explicit; ADRs listed. |
| HLD | 8.5 | **8.5** | Build-plan / CG graph faithful; CMP layers; G6 list slightly incomplete (Payment REAL). |
| LLD | 8 | **8.0** | Metadata/fixture/path deep-dive verified on tip; DigiLocker SIM-only export confirmed. |
| TEST-CASES | 7.5 | **6.5** | Holds/evidence mostly right, but E2E TC table did **not** map 1:1 to `ind-soc-002-golden.spec.ts`; conflated G6-TODAY 12/7 with JOURNEY-MOCK 16; hold path abbreviated. |
| Pack index | 8 | **7.5** | Honest gaps; checklist good; claimed completeness ahead of independent review / PR fidelity. |
| **Overall pack (store)** | **8** | **7.4** | Architecture honesty strong; traceability & PR mirror weak. |
| **PR #194 mirror @ `4becf3f`** | — | **4.5** | **P0:** every classic doc truncated (~half `##` sections missing vs store). Not reviewable as SoT mirror. |

### 1.2 Demo % vs G6 % (re-confirmed, not re-invented)

| Lens | % | Independent verdict |
|---|---:|---|
| SAMPLE_LAB demo-ready | **~58%** | **Accept** — JOURNEY-MOCK 16 passed + Odisha sample + shells 20/20; SIMULATED DigiLocker; lab JSON store. |
| Platform-backed golden path | **~28%** | **Accept** — engines exist (M01–M09 exits) but journey not wired through CMP-015/Temporal/RLS/TSB seal. |
| G6 release-ready | **~3%** | **Accept** — holds inventory only; `G6_ISSUED=false`; no REAL DigiLocker/G5/resilience/UX4G READY/TSB seal. |

---

## 2. Findings

### P0 — blocking

| ID | Finding | Evidence | Disposition |
|---|---|---|---|
| P0-1 | **PR #194 docs truncated** vs store pack | Store BRD 10 `##` sections / PR 5; TEST-CASES 9 / 4; same pattern all classics. PR unusable as repo mirror. | **Fixed** by syncing full store content (sans store frontmatter) to branch `cursor/mvp-documentation-pack-f8c1` |
| P0-2 | TEST-CASES E2E IDs invent a parallel catalogue that mis-maps tip tests and mixes evidence packs | Spec has 16 named tests in 5 describe blocks; author TC-E2E-01…10 ≠ titles; G6-TODAY 12/7 vs JOURNEY 16 not separated | **Fixed** in store + PR TEST-CASES remap |

### P1 — must-fix for high pack quality

| ID | Finding | Evidence | Disposition |
|---|---|---|---|
| P1-1 | BR-H1 wording broken | “inventable ≠ available” | **Fixed** |
| P1-2 | Stale SoT: `M10-G6-PREREQUISITES.md` still claims journey E2E=false | Tip #186 JOURNEY-MOCK 16 passed; prereq doc not updated on main | **Documented** in readiness / HLD / SRS / TEST-CASES (do **not** invent G6 clearance; platform path still HOLD). Repo prereq refresh is a separate docs change (owner/M10 lane). |
| P1-3 | INT-001 FRS shortened vs `integration-map.yaml` | Map: “Auth → profile → DigiLocker/consent” | **Fixed** |
| P1-4 | HLD G6 list omitted Payment REAL hold | Readiness §3 lists it; Constitution/INT-007 | **Fixed** |
| P1-5 | LLD “or equivalent” for m10-sample-lab | Package exists at `packages/m10-sample-lab` | **Fixed** |
| P1-6 | Vitest re-run command omitted config path | Tip uses `tests/integration/m10/vitest.config.ts` | **Fixed** |
| P1-7 | TC-HOLD-CONN path not fully qualified | Actual: `tests/integration/m10/g6-connector-hold.test.ts` | **Fixed** |

### P2 — non-blocking / owner inputs

| ID | Finding | Why not inventable here |
|---|---|---|
| P2-1 | No stakeholder-signed BRD | Needs human business sign-off |
| P2-2 | `specs/requirements/` + `tests/traceability/requirements-tests.yaml` missing | Declared by `TRACEABILITY.md`; creating a full REQ registry is a program SoT task, not MVP narrative glue |
| P2-3 | Pack REQs are pack-local (SRS-F-*) | Acceptable as secondary synthesis; cannot claim authority over DOCX/YAML |
| P2-4 | Not every CMP has enumerated TCs | Point to `services/cmp-*/test` + module gate records instead |
| P2-5 | Visual regression tooling absent | True gap; correctly listed |
| P2-6 | `M10-G6-RECOMMENDATION.md` still describes G6-TODAY golden 12+7 skips without JOURNEY-MOCK | Same tip-staleness class as P1-2; recommend M10 doc refresh PR (out of this pack’s invent-policy scope if it rewrites gate narrative) |

---

## 3. Architecture / honesty audit

| Check | Result |
|---|---|
| No invented statute / Act sections | **PASS** — Odisha facts labeled SAMPLE_LAB; DigiLocker/DLT `SAMPLE_LAB_*` |
| CERTIFIED/G6 claims | **PASS** — false everywhere checked |
| DigiLocker REAL / Payment REAL | **PASS** — G6-HOLD / held; CMP-012 exports Simulated only |
| Lab vs platform path | **PASS** (after fixes) — FRS-LAB vs FRS-RC; SDD/LLD deviation explicit |
| Constitution alignment (OPA/GoRules/Temporal/PG/RLS/immutability/no LLM decision) | **PASS** |
| Demo % ≠ G6 % | **PASS** |
| Build-plan M10→G6, M11/M12 depends_on M10 | **PASS** |
| Evidence packs cited exist | **PASS** — SF-M10-ODISHA-SAMPLE, G6-PREREQ, G6-TODAY, JOURNEY-MOCK, HOST |

---

## 4. What was fixed (this reviewer)

Store paths under `/cursor/stores/self/docs/`:

1. `mvp-pack/BRD.md` — BR-H1 wording  
2. `mvp-pack/FRS.md` — INT-001 spine text  
3. `mvp-pack/SRS.md` — journey evidence + prereq staleness note  
4. `mvp-pack/SDD.md` — package path + Simulated-only export  
5. `mvp-pack/HLD.md` — journey SoT caveat; Payment REAL in G6 list  
6. `mvp-pack/LLD.md` — concrete `packages/m10-sample-lab`  
7. `mvp-pack/TEST-CASES.md` — 1:1 E2E remap; evidence split; hold path; vitest config; REQ trace updates  
8. `mvp-readiness.md` — prereq SoT caveat  
9. `mvp-documentation-pack.md` — review link + rescored index (this turn)  
10. Repo PR #194 — full pack sync (see §6)

**Not claimed / not invented:** REAL DigiLocker, G6 issuance, PERF numbers, resilience RTO/RPO, UX4G READY, TSB seal, signed BRD, formal REQ registry.

---

## 5. Why 10/10 is impossible without owner inputs

A synthesized secondary pack can approach **~9/10 documentation quality**, but not **10/10 program SoT completeness**, because:

1. Stakeholder-signed BRD is absent.  
2. `TRACEABILITY.md` authority (`specs/requirements/` + requirements-tests.yaml) is missing.  
3. Platform-path golden E2E / REAL DigiLocker / G5 / resilience / UX4G READY / TSB seal remain **execution** gaps — docs can only document HOLDs, not close them.  
4. Authoritative DOCX (AWS v1.7 / Eng v1.4) remain primary; this pack must stay secondary.

---

## 6. Final recommended scores (after fixes)

| Document | Final score |
|---|---:|
| Readiness | **9.0** |
| BRD | **8.5** |
| SRS | **7.5** |
| FRS | **8.5** |
| SDD | **8.5** |
| HLD | **9.0** |
| LLD | **8.5** |
| TEST-CASES | **8.5** |
| Pack index | **9.0** |
| **Overall pack (store + synced PR)** | **8.5 / 10** |

**Recommendation:** Keep [#194](https://github.com/dbn1972/serviceform-ai/pull/194) **DRAFT** until CI green on the post-fix commit; then human may merge as docs-only. **Do not** treat merge as G6 or CERTIFIED. Optionally open a separate tip-doc refresh for `M10-G6-PREREQUISITES.md` / `M10-G6-RECOMMENDATION.md` to cite JOURNEY-MOCK without clearing holds.

---

## 7. Checklist (reviewer ticks)

- [x] Tip SHA still `0ceb890…`  
- [x] Pack matches Constitution / ADRs (no invented statute)  
- [x] SAMPLE_LAB / SIMULATED / G6-HOLD consistent (after remap)  
- [x] DigiLocker REAL + Payment REAL documented as holds  
- [x] Demo ~58% vs G6 ~3% separate; CERTIFIED false  
- [x] Repo SoT links resolve (spot-checked)  
- [x] Test catalogue maps to real `tests/` + `evidence/SF-M10-*` (after fix)  
- [x] PR docs-only; CI must be re-checked after sync push  
- [x] Recommend revise-then-merge when CI green — **not** G6  
- [ ] Tracker item close — human/coordinator after accept  

---

## 8. Bottom line

Pack is an **honest secondary synthesis** of tip `0ceb890` SAMPLE_LAB MVP state. Author self-score 8/10 was slightly optimistic given PR truncation and TEST-CASES mapping defects. After independent fixes: **8.5/10** overall. **CERTIFIED and G6 remain false.**
