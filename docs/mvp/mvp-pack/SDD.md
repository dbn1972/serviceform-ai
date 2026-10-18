# SDD — ServiceForm AI MVP (system design)

**Document class:** System Design Document (synthesized)  
**Tip SHA:** `0ceb890e4007242be7b4fd3800c208063b6d7502`  
**CERTIFIED:** false · **G6:** false  

Extends — does not replace — AWS v1.7 DOCX, Eng v1.4 DOCX, and `ARCHITECTURE-CONSTITUTION.md`.

---

## 1. Design goals

1. **Metadata over code** for normal services.  
2. **Separation of concerns:** OPA (authz) · GoRules (deterministic business rules) · Temporal (sequencing) · PostgreSQL (authoritative state/RLS).  
3. **Immutable published versions** with applications pinning TenantServiceBinding versions.  
4. **Connector SPI** with REAL / SANDBOX / SIMULATED modes (INT-013).  
5. **Fail closed** on missing owner policy, SIMULATED-in-prod, and cross-tenant access.  
6. **No LLM statutory decisions.**

---

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

---

## 3. Key design decisions (accepted ADRs)

| ADR | Decision impact on MVP |
|---|---|
| ADR-0001 | Canonical build sequence M00–M12; golden after credentials/discovery |
| ADR-0002 | Canonical event envelope |
| ADR-0003 | Withdrawal/cancellation request states |
| ADR-0004 | Greenfield repository layout |
| ADR-0005 | AuthZ policy version for in-flight cases |
| ADR-0006 | Per-component write roles |

Frozen contracts: `orchestrator/contracts-lock.yaml`.

---

## 4. Runtime data & control flow (target golden path)

1. Studio authors metadata → maker-checker → **publish TSB** (CMP-052) → immutable pins.  
2. Citizen discovers offering (CMP-006/001) → draft application (INT-003).  
3. Form + rules + evidence → durable submit (INT-004) → Temporal workflow (INT-005).  
4. Fee quote; payment if fee > 0 (INT-007); Odisha SAMPLE_LAB fee ₹0 skips PSP.  
5. Officer tasks via OPA; deficiency/SLA (INT-009).  
6. Approval → signing → credential → DigiLocker publish (INT-008).  
7. Every step audited; tenant context mandatory (INT-011).

### Tip SAMPLE_LAB deviation (documented)

Journey mock bypasses durable case/Temporal/RLS engines and uses `packages/m10-sample-lab` (`@serviceform/m10-sample-lab`) JSON persistence + in-app DigiLocker mock (`mockDigiLockerPublish`). This is **intentional demo scaffolding**, not the system design target. G6 evidence MUST use the target path. CMP-012 on tip exports `SimulatedDigiLockerConnector` only — no REAL/SANDBOX HTTP adapter.

---

## 5. Tenancy & security design

| Control | Design |
|---|---|
| Tenant context | Request envelope + RLS session vars |
| Isolation | FORCE RLS; negative tests INT-011 |
| AuthZ | OPA decisions pinned per case policy version (ADR-0005) |
| Secrets | Vault/SM refs for non-SIMULATED connectors |
| Audit | CMP-030; no PII in logs |
| AI boundary | CMP-039 gateway; assistance only |

---

## 6. Connector design

| Connector | SPI | Tip | Production |
|---|---|---|---|
| DigiLocker CMP-012 | SF-CON-DIGILOCKER-PUBLISH + simulation marker | SimulatedDigiLockerConnector only | REAL required for critical — **G6-HOLD** |
| Payment CMP-021 | SF-CON-PAYMENT-* | simulated-psp | REAL held |
| Notify CMP-025/026 | dispatch contracts | SIMULATED sinks | Provider when DLT ready |

Mode mismatch between adapter and binding MUST fail closed (`ADAPTER_MODE_MISMATCH`).

---

## 7. UX design baseline

- UX4G 3.0 mandatory (`DESIGN-SYSTEM.md`, `specs/design-system.yaml`).  
- JSON Forms = schema/runtime; UX4G-backed renderers.  
- Tenant branding = token overlay only.  
- Journey UX4G READY flag separate from shell a11y pass — **G6-HOLD**.

---

## 8. Deployment / env design (summary)

| Env | DigiLocker | Payment | Golden claims |
|---|---|---|---|
| LOCAL/CI | SIMULATED required | SIMULATED / ₹0 skip | SAMPLE_LAB demo OK |
| SIT | SIMULATED or SANDBOX | per binding | Lab evidence |
| PRODUCTION | REAL for critical | REAL if fee>0 | Only after G6 |

---

## 9. Open design items (not invented here)

1. REAL DigiLocker HTTP adapter + registrar doc type.  
2. PERF cell capacity / load-profile numbers.  
3. Resilience RTO/RPO targets.  
4. Retiring lab store from G6 evidence path.  
5. Visual regression tooling (none on tip).

**Self-score:** SDD **8/10** (aligned to Constitution; lab deviation explicit).
