# SF-56 Lab fee>0 payment path (SAMPLE_LAB DUMMY)

**Stamp:** `CERTIFIED=false` · `G6=false` · `self_certified=false` · Payment **SIMULATED** only · REAL HubPsp owner-held  
**Gap item:** platform-capability-gap-analysis.md rank 9 (P1) — Lab fee>0 payment path  
**CMP:** CMP-020 Fee Calculation + CMP-021 Payment (+ INT-007 callback)  
**Base:** `origin/main` including SF-55 journey notify `#255` (`be6793e3`)

## Verdict

SAMPLE_LAB exercises fee quote → SIMULATED payment intent → HMAC callback → `MARK_RECEIVED` on a labeled **SAMPLE_LAB DUMMY** fee overlay (**IND-EDU-004**, ₹9.99 / 999 paise). Residence (**IND-SOC-002**) stays ₹0 and never enters `PAYMENT_PENDING`. Agents do not self-certify.

## Executed checks (this evidence pack)

| Check | Result |
|---|---|
| Unit (api payment-lab + citizen payment + m10 fee-catalogue) | **10/10 PASS** |
| `pnpm --filter @serviceform/api run typecheck` | PASS |
| `pnpm --filter @serviceform/cmp-021-payment run typecheck` | PASS |
| `pnpm --filter @serviceform/m10-sample-lab run typecheck` | PASS |
| `pnpm --filter @serviceform/web-citizen run typecheck` | PASS |

Logs under this directory. Not CERTIFIED. Not G6.

## Platform wiring

| Piece | Detail |
|---|---|
| Fee overlay | `fixtures/lab/platform/fee-catalogue.json` — IND-EDU-004 FIXED_AMOUNT 999 paise |
| Distinct fee pin | `published-bindings.json` IND-EDU-004 → `0d15bae4-0015-4000-8000-0d15bae40015` |
| Host compose | `apps/api/src/platform/payment.ts` → merges into existing SF-55 `m06` mounts |
| Pools | `DATABASE_URL_CMP020` + `DATABASE_URL_CMP021` (bootstrap roles added) |
| SIM callback | `POST /v1/lab/simulated/payment-callback` (INTEGRATION + HMAC) |
| Workflow signal | CAPTURED → SYSTEM `MARK_RECEIVED` |
| Citizen BFF | `GET/POST /api/portal/applications/[id]/payment` |
| UI | `PaymentStep` on certificate detail when `PAYMENT_REQUIRED` |
| OPA | `FEE_QUOTE_*` / `PAYMENT_*` + citizen grants + `SAMPLE_LAB_PAYMENT_WORKLOAD` / `_INTEGRATION` |

## Honest limits

- Payment REAL / HubPsp still owner-held.
- No invented statute — SAMPLE_LAB DUMMY label only.
- Fee mount optional until lab bootstrap env includes CMP020/021.
- **CERTIFIED=false. G6=false.** Agents do not self-certify.
