# WS4 — Golden path proof (Residence + Income SAMPLE_LAB ceiling)

**Stamp:** SAMPLE_LAB · DigiLocker/OTP/IdP/SMS/Payment **SIMULATED** · **CERTIFIED=false** · **G6=false** · **self_certified=false** · **TSB_seal(G6)=false**  
**Tip:** `ca244c69ec622f243ded2bfd1b24441b831ac47d` (`ca244c69`) — main with SF-71  
**Executed:** 2026-11-24 20:08 Asia/Calcutta (IST) · Cursor cloud VM loopback  
**Re-run:** `scripts/dev/ws4-golden-path-evidence.sh` (requires `platform-lab.sh up`)

## Mission

1. Prove **Residence Certificate (IND-SOC-002)** created/applied via Studio metadata only — no service-specific backend.
2. Prove **second service (Income IND-SOC-031)** as far as SAMPLE_LAB allows **without inventing statute** (SF-33 blocker).

## Executed results

| Suite | Result | Artefact |
|---|---|---|
| Playwright e2e (full shells + golden + M11 + Studio designers + platform journey) | **107 passed** (1.6m) | `logs/e2e-golden-m11.log`, `junit/e2e.xml` |
| Golden IND-SOC-002 (`tests/e2e/golden/ind-soc-002-golden.spec.ts`) | **all pass** incl. Studio author → citizen apply → officer multi-desk → DigiLocker SIM | same log |
| M11 Income lab-offer (`tests/e2e/m11-second-service-reuse.spec.ts`) | **4/4 pass** | same log |
| Certificate representatives (incl. IND-SOC-002 + IND-SOC-031 DUMMY apply→officer→SIM DigiLocker) | **pass** | same log |
| `@serviceform/service-templates` catalogue + lab-offer + M11 dry-run fixtures | **657 pass** | `logs/unit-templates.log` |
| `@serviceform/web-citizen` M11 Income gate | **3 pass** | `logs/unit-citizen-income-gate.log` |

## Residence Golden path (metadata only)

| Step | Evidence |
|---|---|
| Studio author IND-SOC-002 metadata (`/services/new`) | Golden E2E “author IND-SOC-002… without bespoke backend code” |
| Citizen apply on pinned published form | Golden E2E wizard → preview → submit |
| Officer HUMAN decision (multi-desk) | Forward → Approve |
| Credential + DigiLocker **SIMULATED** publish | “Saved to DigiLocker (SIMULATED)” / `DigiLocker · PUBLISHED` |
| No `services/**` Residence-named backend | Architecture Constitution §30; engines remain generic CMP-009/015/016 |

## Income second-service ceiling (SAMPLE_LAB)

| Allowed without SF-33 | Status |
|---|---|
| Studio authoring shell `templates/income-certificate/` | READY |
| Catalogue maturity `SAMPLE_LAB_STUB` / version `DRAFT` | HELD |
| SAMPLE_LAB DUMMY fee/SLA/evidence/credential overlays | READY (SF-61) |
| Placement lab-offer of DRAFT form (fail-closed outside SAMPLE_LAB) | E2E pass |
| Citizen apply metadata form + representative DUMMY journey → SIM DigiLocker | E2E pass |
| Statutory **PUBLISH** / non-DUMMY citizen offer / G3 second-service exit | **BLOCKED — SF-33** |

## SF-33 blocker (do not invent)

Owner task **SF-33** must supply IND-SOC-031 policy inputs before statutory PUBLISH. Inventory: `fixtures/m11/ind-soc-031/POLICY_INPUT_REQUIRED.md`.

| # | Input | Lab today | Owner action |
|---|---|---|---|
| 1 | Legal basis / Act section | SAMPLE_LAB DUMMY placeholder | Replace with authorized citation |
| 2 | Eligibility rules | Synthetic summary | Authorized thresholds / household / period |
| 3 | Evidence list | `SAMPLE_LAB_DUMMY_EVIDENCE_ANY` | Authorized evidence catalogue |
| 4 | Fee schedule | ₹9.99 DUMMY | Authorized fee (do not assume ₹0) |
| 5 | SLA days + anchors | 15 working days DUMMY | Authorized SLA |
| 6 | Credential / DigiLocker doc type | `SAMPLE_LAB_DUMMY_IND_SOC_031_V1` SIM | Authorized label + REAL path later |
| 7 | Notification / DLT PE-ID | SAMPLE_LAB DLT placeholder | Owner/G6 REAL SMS |

**Lab-offer ≠ PUBLISHED.** Agents must not invent Odisha/statutory Income eligibility, fee, or DigiLocker registration.

## Honesty

- No service-specific backend for Residence or Income.
- No REAL DigiLocker / SMS / Payment credentials.
- **CERTIFIED=false. G6=false.** Agents do not self-certify.
- Module M11 G3 exit remains open until SF-33 + second-service E2E on generic engines as G3 proof.
