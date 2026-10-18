# ServiceForm AI — MVP readiness scorecard

**For:** Debabrata Nayak  
**Repo:** `dbn1972/serviceform-ai`  
**Tip assessed:** `0ceb890e4007242be7b4fd3800c208063b6d7502` (`origin/main`, merge #186 journey mock)  
**Assessment date:** 2026-10-18  
**Pack completeness (self-score):** **8/10** — classic docs synthesized; independent review still pending; G6 holds unchanged  

| Lens | % | Meaning |
|---|---:|---|
| **SAMPLE_LAB demo-ready** | **~58%** | Stakeholder walkthrough: apply → approve → DigiLocker **SIMULATED** |
| **Platform-backed golden path** | **~28%** | Real case/Temporal/RLS/TSB/DigiLocker adapters on the journey |
| **G6 release-ready** | **~3%** | Inventory + holds only; human `G6_RELEASE_CERTIFIED` **not issued** |

**Explicit non-claims:** `CERTIFIED=false` · `G6=false` · `g6_issued=false` · DigiLocker REAL=**held** · Payment REAL=**held** · `self_certified=false`

Related pack index: [`mvp-documentation-pack.md`](./mvp-documentation-pack.md) · Internal scorecard detail: [`../internal/mvp-readiness-scorecard-0ceb890.md`](../internal/mvp-readiness-scorecard-0ceb890.md)

---

## 1. Tip SHA

| Check | Result |
|---|---|
| `git rev-parse HEAD` / `origin/main` | `0ceb890e4007242be7b4fd3800c208063b6d7502` |
| Subject | Merge PR #186 — IND-SOC-002 SAMPLE_LAB journey mock |
| Recent M10 chain | #183 Odisha → #184 G6 prereq → #185 shells → #186 journey @ tip |
| Open polish (not on tip) | [#193](https://github.com/dbn1972/serviceform-ai/pull/193) UX form wizard **DRAFT** |

---

## 2. Module / gate status (human-issued exits on tip)

| Module | Exit gate | Issued? | Citation on tip |
|---|---|---|---|
| M00 Bootstrap | G1_BUILD_READY | Recommended (no formal `gate_issued` record) | `evidence/M00/` |
| M01 Foundation | G4_SECURITY_VERIFIED | **yes** | `docs/verification/M01-G4-EXIT.md` |
| M02 Identity | G3_INTEGRATION_VERIFIED | **yes** | `docs/verification/M02-G3-RECOMMENDATION.md` |
| M03 Catalogue/Studio/UX4G | G3 | **yes** | `docs/verification/M03-G3-RECOMMENDATION.md` |
| M04 Forms/Rules/Evidence/AI | G3 | **yes** | `docs/verification/M04-G3-GATE-RECORD.md` |
| M05 Case/Workflow | G4 | **yes** | `docs/verification/M05-G4-GATE-RECORD.md` (#110) |
| M06 Fees/Pay/Notify | G3 | **yes** | `docs/verification/M06-G3-GATE-RECORD.md` — **Payment REAL deferred** |
| M07 Credentials/DigiLocker | G3 | **yes** | `docs/verification/M07-G3-GATE-RECORD.md` — **DigiLocker REAL deferred** |
| M08 Search/Analytics/Ops | G3 | **yes** | `docs/verification/M08-G3-GATE-RECORD.md` |
| M09 Interop/Trust | G4 | **yes** | `docs/verification/M09-G4-GATE-RECORD.md` (#182 @ `73b586e`) |
| **M10 Golden Residence** | **G6_RELEASE_CERTIFIED** | **no — HOLD** | `docs/verification/M10-G6-PREREQUISITES.md`, `M10-G6-RECOMMENDATION.md` |
| M11 Second-service reuse | G3 | not started | `depends_on: [M10]` |
| M12 AI assistants | G4 | not started | `depends_on: [M10]` |

**Program reading:** M01–M09 exits issued (platform backbone through interoperability). M10 SAMPLE_LAB demo exists; G6 not issuable. M11/M12 awaiting go.

---

## 3. Demo-ready vs G6-release-ready

### Demo-ready (~58%) — SAMPLE_LAB walkthrough

| Layer | State |
|---|---|
| Odisha public policy sample | Resolved (#183) — eligibility ≥1y, fee ₹0, SLA 10 WD |
| Template `SAMPLE_CANDIDATE` v0.2.0-odisha-sample | `templates/residence-certificate/**` |
| Citizen apply → officer approve → DigiLocker SIMULATED | `apps/web-citizen`, `apps/web-officer`; golden E2E **16 passed** (`evidence/SF-M10-JOURNEY-MOCK/`) |
| Shell a11y | 20/20 (`evidence/SF-M10-G6-TODAY/`) |
| M10 INT harness | 24 passed · 6 todo with owner-ready flag |

**Honest label for any demo:** SAMPLE_LAB · SIMULATED DigiLocker · lab JSON store · **not** production · **not** G6.

### Not demo-as-production (~28% platform path)

Journey uses `@serviceform/m10-sample-lab` JSON file store — **not** CMP-015/016 case engines, Temporal, or Aurora FORCE RLS path. DigiLocker is in-app mock mirroring CMP-012 SIMULATED markers. TSB `tsb_immutability_sealed: false`. Studio sealed golden publish not exercised end-to-end.

### G6-release-ready (~3%) — blockers

From `docs/verification/M10-G6-PREREQUISITES.md` (plus tip #186 journey mock):

1. **REAL DigiLocker** — registrar credentials + registered doc type + REAL adapter (**G6-HOLD**)  
2. Wire UI → real APIs (retire lab store as G6 evidence)  
3. **G5 PERF** — `SF_M10_G5_PERF_READY` unset; schema-only `load-profile.yaml`  
4. **Resilience / backup-restore / rollback** — `SF_M10_RESILIENCE_READY` unset  
5. **UX4G journey READY** — `SF_M10_UX4G_READY` unset; #193 still DRAFT  
6. **TSB immutability seal** — deferred until REAL DigiLocker/DLT  
7. **Payment REAL** — held for non-zero fee tenants (Odisha ₹0 lab skip OK)  
8. Human issues `G6_RELEASE_CERTIFIED` after independent EVD re-bind  

**SoT caveat:** `M10-G6-PREREQUISITES.md` non-claims still say `journey E2E=false` from the pre-#186 inventory. On tip `0ceb890`, SAMPLE_LAB journey E2E is **16 passed** (`SF-M10-JOURNEY-MOCK`); that does **not** clear platform-path / G6 journey requirements.  

---

## 4. Weighted demo methodology (conservative)

| Weight | Criterion | Score | Contribution |
|---|---:|---:|---:|
| 20% | M01–M09 exits issued | 1.0 | 20 |
| 15% | Golden metadata + Odisha sample | 1.0 | 15 |
| 20% | Citizen→officer→credential UI runnable | 0.85 | 17 |
| 10% | DigiLocker in journey | 0.40 (SIM only) | 4 |
| 10% | Studio authoring narrative | 0.55 | 5.5 |
| 10% | Wired to authoritative engines | 0.15 | 1.5 |
| 10% | UX polish / UX4G journey evidence | 0.35 | 3.5 |
| 5% | Payment path (non-zero) | 0.20 | 1 |
| | | | **≈ 58** |

G6 % ≈ 3%: only policy sample + fail-closed holds + scaffolding evidence toward nine release prerequisites.

---

## 5. Evidence index (M10)

| Pack | Role |
|---|---|
| `evidence/SF-M10-ODISHA-SAMPLE/` | Policy sample bind |
| `evidence/SF-M10-G6-PREREQ/` | Hold suites + INT 24/6 |
| `evidence/SF-M10-G6-TODAY/` | Shells + DigiLocker SIM lab |
| `evidence/SF-M10-JOURNEY-MOCK/` | Golden E2E 16 passed (SAMPLE_LAB) |
| `evidence/SF-M10-HOST/` | Host metadata admission |

---

## 6. Recommended next actions (ordered)

1. Keep demos labeled SAMPLE_LAB / SIMULATED / G6-HOLD.  
2. Complete/merge UX wizard polish (#193) without claiming UX4G READY.  
3. Wire journey to real CMP APIs when authorized (separate builder wave).  
4. Obtain DigiLocker registrar + PERF cell + resilience cell from owner/ops.  
5. Independent doc review of this pack (tracker item).  
6. Do **not** set `SF_M10_*_READY=1` or issue G6 without human gate + REAL connectors.

---

## Bottom line

Platform modules through **M09 are exit-gated**. M10 offers an **honest SAMPLE_LAB demo** on tip `0ceb890`. Treat **~58% demo** and **~3% G6-release** as separate numbers. This worker does not certify.
