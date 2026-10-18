
# SDD — ServiceForm AI MVP (system design)

**Document class:** System Design Document (synthesized)  
**Tip SHA:** `0ceb890e4007242be7b4fd3800c208063b6d7502`  
**CERTIFIED:** false · **G6:** false  

Extends — does not replace — AWS v1.7 DOCX, Eng v1.4 DOCX, and `ARCHITECTURE-CONSTITUTION.md`.


## 2. Logical architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  Surfaces (UX4G): citizen · officer · studio · admin · mobile │
└───────────────┬─────────────────────────────┬───────────────┘
                │ BFF / API host               │
┌───────────────▼─────────────────────────────▼───────────────┐
│  Composition host (apps/api) — module plugin mounts M01–M10   │
│  CMP services via FROZEN OpenAPI / events / outbox            │
└───────┬─────────────┬──────────────┬─────────────┬──────────┘
        │             │              │             │
   ┌────▼────┐   ┌────▼────┐   ┌─────▼─────┐  ┌───▼────┐
   │  OPA    │   │ GoRules │   │ Temporal  │  │Connect.│
   └────┬────┘   └────┬────┘   └─────┬─────┘  └───┬────┘
        │             │              │            │ SIMULATED*
        └─────────────┴──────┬───────┴────────────┘
                             ▼
                    Aurora PostgreSQL + FORCE RLS
                    (outbox, audit, pin graph)
```

\* DigiLocker/Payment REAL adapters = **G6-HOLD** on tip.


## 4. Runtime data & control flow (target golden path)

1. Studio authors metadata → maker-checker → **publish TSB** (CMP-052) → immutable pins.  
2. Citizen discovers offering (CMP-006/001) → draft application (INT-003).  
3. Form + rules + evidence → durable submit (INT-004) → Temporal workflow (INT-005).  
4. Fee quote; payment if fee > 0 (INT-007); Odisha SAMPLE_LAB fee ₹0 skips PSP.  
5. Officer tasks via OPA; deficiency/SLA (INT-009).  
6. Approval → signing → credential → DigiLocker publish (INT-008).  
7. Every step audited; tenant context mandatory (INT-011).

### Tip SAMPLE_LAB deviation (documented)

Journey mock bypasses durable case/Temporal/RLS engines and uses `@serviceform/m10-sample-lab` JSON persistence + in-app DigiLocker mock. This is **intentional demo scaffolding**, not the system design target. G6 evidence MUST use the target path.


## 6. Connector design

| Connector | SPI | Tip | Production |
|---|---|---|---|
| DigiLocker CMP-012 | SF-CON-DIGILOCKER-PUBLISH + simulation marker | SimulatedDigiLockerConnector only | REAL required for critical — **G6-HOLD** |
| Payment CMP-021 | SF-CON-PAYMENT-* | simulated-psp | REAL held |
| Notify CMP-025/026 | dispatch contracts | SIMULATED sinks | Provider when DLT ready |

Mode mismatch between adapter and binding MUST fail closed (`ADAPTER_MODE_MISMATCH`).


## 8. Deployment / env design (summary)

| Env | DigiLocker | Payment | Golden claims |
|---|---|---|---|
| LOCAL/CI | SIMULATED required | SIMULATED / ₹0 skip | SAMPLE_LAB demo OK |
| SIT | SIMULATED or SANDBOX | per binding | Lab evidence |
| PRODUCTION | REAL for critical | REAL if fee>0 | Only after G6 |

