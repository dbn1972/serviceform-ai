# Owner blocker list — Workstream 5 / SF-2 G6 prep

**Agents prepare wiring and harnesses only. Humans clear these before G6 conversation.**  
**CERTIFIED=false · G6=false · DigiLocker/SMS/Payment REAL=false**

| ID | Blocker | Owner action | Agent-prep artifact | Cleared? |
|---|---|---|---|---|
| OB-01 | ADR-0007 PROPOSED | Accept D-1…D-4 or direct alternative; human Status edit | [`ADR-0007-0008-OWNER-ACCEPT-READINESS.md`](./ADR-0007-0008-OWNER-ACCEPT-READINESS.md) | **No** |
| OB-02 | ADR-0008 PROPOSED | Accept D-1…D-3; supply PRODUCTION BFF hop CIDRs | Same + `trusted-proxy.adr0008.env.stub` | **No** |
| OB-03 | REAL DigiLocker | Registrar credentials + registered doc type (not SAMPLE_LAB_*) + REAL adapter host mount | [`REAL-CONNECTOR-SWITCH-CHECKLIST.md`](./REAL-CONNECTOR-SWITCH-CHECKLIST.md) §1 | **No** |
| OB-04 | REAL SMS/OTP | SMS/DLT credentials + templates + REAL OTP binding; SEC after ADR-0008 | Checklist §2 + `sms-otp.real.env.stub` | **No** |
| OB-05 | Payment REAL | PSP credentials + HubPsp host mount (SF-M06-005); SANDBOX then REAL | Checklist §3 + `payment.real.env.stub` | **No** |
| OB-06 | G5 PERF | Authorize PERF/SIT cell + fill `tests/performance/m10/load-profile.yaml` numbers; set `SF_M10_G5_PERF_READY=1` only then | Hold suite + harness runner | **No** |
| OB-07 | Resilience / backup / rollback | Ops runbook + restore cell + RTO/RPO; set `SF_M10_RESILIENCE_READY=1` only then | `tests/resilience/m10/*` scaffolds | **No** |
| OB-08 | TSB immutability seal (G6 gate) | Seal after REAL DigiLocker/DLT; lab_eng_sealed ≠ G6 seal | `g6-connector-hold.test.ts` | **No** |
| OB-09 | UX4G READY bind (SF-15) | Human UX4G journey evidence pack + `SF_M10_UX4G_READY` | [`SF-15-UX4G-READY-BIND-PREP.md`](../SF-15-UX4G-READY-BIND-PREP.md) + [`UX4G-SCREEN-READER-SMOKE-CHECKLIST.md`](../UX4G-SCREEN-READER-SMOKE-CHECKLIST.md) (P8-4; flag unset) | **No** |
| OB-10 | Human G6 issuance | Independent EVD re-bind then human `G6_RELEASE_CERTIFIED` | Agents recommend hold only | **No** |

## Related program holds (not invented here)

- **SF-33** IND-SOC-031 SAMPLE_LAB policy inputs (Income statute) — Workstream 4  
- **SF-20** Postgres 16→18 Dependabot hold  

## What agents already cleared (prep only)

- Fail-closed G5 / resilience / connector hold suites (schema-only targets remain null)
- REAL switch checklist + env **name** stubs (no secret values)
- ADR accept readiness notes (Status still PROPOSED)
- Lab hold evidence pack `evidence/SF-WS5-G6-PREP/` (holds only — not G6)

## Forbidden agent claims

Do not mark OB-01…OB-10 cleared. Do not claim DigiLocker/SMS/Payment REAL complete. Do not claim G6 or CERTIFIED.
