# M11 Income (IND-SOC-031) — SAMPLE_LAB config-reuse dry-run

**Stamp:** `SAMPLE_LAB` · DigiLocker **SIMULATED** · `CERTIFIED=false` · `G6=false` · `self_certified=false` · `TSB_seal(G6)=false`  
**SF-61** path/fixtures polish. **SF-33** still owns real statute / non-DUMMY policy inputs.

## What this proves

Income Certificate can be authored as a **second service** through Studio metadata + pin graph **without** a bespoke `services/**` backend. Maturity stays `SAMPLE_LAB_STUB` / version `DRAFT`. Lab placement may lab-offer the DRAFT form with **SAMPLE_LAB DUMMY** params (fail-closed outside SAMPLE_LAB). This is **not** a PUBLISHED statutory offering.

## Dry-run path (Studio → TSB pin graph → portal)

| Step | Surface | Artefact / action |
|---|---|---|
| 1 | Studio template | `/templates/ind-soc-031.income-certificate` |
| 2 | Forms designer | `/forms/designer?template=ind-soc-031.income-certificate` |
| 3 | Rules / Workflow | `/rules`, `/workflows` (DUMMY advisory / Temporal shell) |
| 4 | Fee / SLA / Evidence / Credential | Designer starters `ind-soc-031-*` (SAMPLE_LAB DUMMY) |
| 5 | Freeze + maker | CMP-033 → CMP-051 maker-checker (see `maker-checker-dry-run.yaml`) |
| 6 | TSB pin graph (dry-run) | `tsb-dry-run-fixture.json` — **not** G6-sealed; publication_state dry-run |
| 7 | Portal lab-offer | Placement binds DRAFT form (`fixtures/lab/platform/placement.citizen.json`) |

## Files

| File | Role |
|---|---|
| `POLICY_INPUT_REQUIRED.md` | Owner SF-33 inventory (DUMMY filled for lab; real statute still required) |
| `tsb-dry-run-fixture.json` | Sample TSB pin graph for dry-run (DRAFT / DUMMY) |
| `maker-checker-dry-run.yaml` | Maker ≠ checker dry-run record (stops short of statutory PUBLISH) |
| `tenant-overlay.sample-lab-dummy.yaml` | SAMPLE_LAB DUMMY overlay (not Odisha/Act citation) |
| `path-checklist.md` | Operator checklist for the dry-run |

## Honesty gates

- Do **not** invent Income eligibility thresholds, Act sections, fee schedules, or DigiLocker registrar labels.
- Do **not** mark version `PUBLISHED` or maturity `SAMPLE_LAB_PUBLISHED` without SF-33 owner policy.
- DigiLocker / SMS / Payment remain **SIMULATED** / deferred — no REAL connector work in SF-61.
- Agents do not self-certify.
