# SF-61 — M11 Income second-service path polish (SAMPLE_LAB)

**Stamp:** SAMPLE_LAB · DigiLocker **SIMULATED** · **CERTIFIED=false** · **G6=false** · **self_certified=false** · **TSB_seal(G6)=false**  
**Scope:** Path / fixtures / docs / Studio DUMMY designer starters for IND-SOC-031. No invented statute. No PUBLISHED statutory offer. No DigiLocker/SMS/Payment REAL.

## Delivered

| Area | Change |
|---|---|
| Dry-run fixtures | `fixtures/m11/ind-soc-031/` README, path checklist, TSB dry-run, maker-checker dry-run, DUMMY overlay |
| Catalogue DUMMY inventory | `fixtures/catalogue/certificate-packs/ind-soc-031.SAMPLE_LAB_DUMMY.md` (gap fill) |
| Authoring shell docs | `templates/income-certificate/` README + SAMPLE_LAB_DUMMY + form.schema description |
| Studio designers | Fee/SLA/Evidence/Credential starters `ind-soc-031-*` (SAMPLE_LAB DUMMY) |
| Studio UI | Home Income dry-run card; template detail designer path links |
| Docs | CCR-M11-001 + M11 delta report honesty (lab-offer ≠ PUBLISHED; SF-33) |
| Tests | `m11-income-dry-run-fixtures.test.ts`; meta-kinds + meta-designers; e2e Fee starter |

## Honesty gates held

- Maturity `SAMPLE_LAB_STUB` / version `DRAFT` unchanged
- SF-33 still required for statutory PUBLISH
- DigiLocker/SMS/Payment REAL not touched
- CERTIFIED=false · G6=false · no self-certify

## Executed checks (local)

| Check | Result |
|---|---|
| `vitest` meta-kinds + m11 dry-run fixtures + meta-designers + m11-income-gated | **15 pass** (`vitest-unit.log`, `junit/unit.xml`) |
| typecheck studio-designers / web-studio / service-templates | **pass** |

E2E: `tests/e2e/m11-second-service-reuse.spec.ts` (CI Playwright suite).

Tip SHA and PR recorded in store wrap `docs/m11-income-polish.md` after push.
