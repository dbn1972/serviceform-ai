# REAL connector switch checklist (G6 prep)

**CERTIFIED=false · G6=false · self_certified=false**  
**Scope:** Agent-buildable readiness only. Does **not** complete DigiLocker / SMS / Payment REAL.  
**Do not invent credentials, doc types, DLT PE-IDs, PSP merchant IDs, or load numbers.**

Config stubs (names only): [`config-stubs/`](./config-stubs/).

## Shared fail-closed rules (INT-013 + Constitution #22)

| Rule | Lab (`LOCAL` / `CI` / `SAMPLE_LAB`) | Production-critical |
|---|---|---|
| Mode | `SIMULATED` only | `REAL` required |
| `secret_ref` | null / unused | Required (CMP-037 binding) |
| Simulation marker | Required on SIM paths | Forbidden |
| SAMPLE_LAB_* doc types / PE-IDs | Allowed | Refused |
| Env match | Binding env = runtime | Binding env = `PRODUCTION` |

Hold suite: `tests/integration/m10/g6-connector-hold.test.ts`.

---

## 1. DigiLocker (CMP-012 publish + CMP-004 identity link)

**Today:** SIMULATED only (`SimulatedDigiLockerConnector`). No REAL HTTP adapter in tree.  
**Owner supplies (not inventable):**

- [ ] DigiLocker partner / issuer registration credentials (into secret store; never into git)
- [ ] Registered document type for the production TSB (not `SAMPLE_LAB_*`)
- [ ] Consent / purpose codes aligned with CMP-030
- [ ] CMP-037 connector binding: `mode=REAL`, `critical=true`, `secret_ref=<vault-path>`, env=`PRODUCTION`
- [ ] Host composition switch: stop injecting SIMULATED adapter when binding is REAL
- [ ] Independent INT against SANDBOX (if offered) then REAL; evidence under `evidence/` with run IDs
- [ ] Re-evaluate TSB immutability seal only after REAL DigiLocker **and** DLT bindings exist

**Stub:** `config-stubs/digilocker.real.env.stub`  
**Blocked claim:** DigiLocker REAL complete = **false**

---

## 2. SMS / OTP (CMP-004)

**Today:** `SimulatedOtpAdapter` + lab `SimulatedOtpInbox` (`/v1/simulated/*`). No REAL SMS/DLT adapter.  
**Owner supplies:**

- [ ] SMS / DLT provider credentials + approved template / PE-ID (secret store)
- [ ] CMP-037 OTP binding: `mode=REAL`, `secret_ref`, production env
- [ ] Channel hashing / pepper already in CMP-004 — verify no OTP plaintext in logs
- [ ] Per-client rate limits: ADR-0008 accepted + `SF_TRUSTED_PROXY_HOPS` set to real BFF hop CIDRs (not loopback in PRODUCTION)
- [ ] Independent SEC re-verify of OTP brute-force / F-06 budgets with REAL dispatch
- [ ] Lab inbox endpoints remain refused when `SF_ENVIRONMENT=PRODUCTION`

**Stub:** `config-stubs/sms-otp.real.env.stub`  
**Blocked claim:** SMS/OTP REAL complete = **false**

---

## 3. Payment (CMP-021)

**Today:** SIMULATED PSP for SAMPLE_LAB fee>0 (`IND-EDU-004`). `HubPspConnector` is a structural stub that **throws** until host mount wires SDK + webhook crypto (SF-M06-005).  
**Odisha Residence fee ₹0:** lab skip OK; does **not** clear Payment REAL for non-zero tenants.  
**Owner supplies:**

- [ ] PSP merchant / gateway credentials + webhook signing secrets (secret store)
- [ ] CMP-037 PAYMENT binding: `mode=REAL` or `SANDBOX`, `secret_ref`, critical as required
- [ ] Wire `HubPspConnector` (or successor) at host mount — do not leave throw-stub in PRODUCTION
- [ ] Callback verification + exactly-once effect path exercised against SANDBOX then REAL
- [ ] Fee quotes remain server-side (never client amount) under REAL

**Stub:** `config-stubs/payment.real.env.stub`  
**Blocked claim:** Payment REAL complete = **false**

---

## Switch order (recommended)

1. Owner accepts **ADR-0007** and **ADR-0008** (see [`ADR-0007-0008-OWNER-ACCEPT-READINESS.md`](./ADR-0007-0008-OWNER-ACCEPT-READINESS.md)).
2. Configure trusted BFF hops; SEC re-verify rate limits.
3. SANDBOX DigiLocker / SMS / Payment where available; never jump SIM → PRODUCTION CRITICAL.
4. Fill G5 load-profile + resilience checklist (owner numbers / cells).
5. REAL critical bindings + TSB seal + independent EVD → human may consider G6 (agents do not issue).

## Explicit non-claims

- DigiLocker REAL = **false**
- SMS/OTP REAL = **false**
- Payment REAL = **false**
- G6 / CERTIFIED / self_certified = **false**
