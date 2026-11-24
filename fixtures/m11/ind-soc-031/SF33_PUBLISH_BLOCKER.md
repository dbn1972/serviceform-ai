# SF-33 blocks PUBLISH — IND-SOC-031 Income Certificate

**Stamp:** SAMPLE_LAB · DigiLocker **SIMULATED** · **CERTIFIED=false · G6=false · self_certified=false**  
**P8-6 / D4 Golden-2.** Agents must **not** invent statute or mark Income **PUBLISHED**.

## Verdict

| Gate | Value |
|---|---|
| Statutory **PUBLISH** / non-DUMMY citizen offer | **BLOCKED — owner SF-33** |
| Lab-offer of DRAFT + SAMPLE_LAB DUMMY | **Allowed** (fail-closed outside `SAMPLE_LAB`) |
| Statute / Act citation invented by agents? | **No** |
| Income maturity / version | `SAMPLE_LAB_STUB` / **DRAFT** only |

## Why SF-33 is the only publish blocker

Config-only second-service reuse (Studio metadata → TSB dry-run pin graph → SAMPLE_LAB portal lab-offer) is already exercised. What remains for statutory **PUBLISH** is **owner policy**, not a missing `services/**` backend.

Owner inventory (do not invent): `POLICY_INPUT_REQUIRED.md`

| # | Owner input still required | Lab today |
|---|---|---|
| 1 | Legal basis / Act section | SAMPLE_LAB DUMMY placeholder |
| 2 | Eligibility rules (thresholds, household, period) | Synthetic summary |
| 3 | Evidence catalogue | `SAMPLE_LAB_DUMMY_EVIDENCE_ANY` |
| 4 | Fee schedule | ₹9.99 DUMMY (not ₹0) |
| 5 | SLA days + anchors | 15 working days DUMMY |
| 6 | Credential / DigiLocker document type | DUMMY + SIM only |
| 7 | Notification / DLT PE-ID | Lab placeholder |

Machine-readable mirror: `sf33-publish-gate.json` (same directory).

## Explicit non-claims

- Not CERTIFIED · not G6 · not self-certified  
- DigiLocker REAL **out of scope** for path-to-8  
- Lab-offer ≠ citizen-offerable statutory **PUBLISHED**  
- M11 G3 exit remains **open** until SF-33 owner policy package lands
