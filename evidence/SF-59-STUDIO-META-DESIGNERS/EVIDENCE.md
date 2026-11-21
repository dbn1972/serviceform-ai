# SF-59 — Studio Fee / SLA / Evidence / Credential designers

**Stamp:** SAMPLE_LAB · UX4G · metadata-driven · **CERTIFIED=false** · **G6=false** · **self_certified=false** · **TSB_seal=false**  
**Base tip:** `de17864b` (main at branch start)  
**Scope:** Designer parity with Phase C forms/workflow/rules for CMP-033 kinds FEE, SLA, EVIDENCE, CREDENTIAL. SAMPLE_LAB_DUMMY labels OK. No invented statute.

## Delivered

| Surface | Path | CMP-033 kind | Pin key |
|---|---|---|---|
| Fee designer | `/fees`, `/fees/designer` | FEE | `fee` |
| SLA designer | `/sla`, `/sla/designer` | SLA | `sla` |
| Evidence designer | `/evidence`, `/evidence/designer` | EVIDENCE | `evidence` |
| Credential designer | `/credentials`, `/credentials/designer` | CREDENTIAL | `credential` |

Shared publish path: CMP-033 draft → validate (optional `content_hash` recomputed) → freeze → TenantServiceBinding pin → CMP-051 maker-checker. Pure models in `@serviceform/studio-designers/{fee,sla,evidence,credential}`.

## Executed checks (this branch)

| Check | Result |
|---|---|
| `packages/studio-designers/test/meta-kinds.test.ts` | pass (see `junit/unit.xml`) |
| `apps/web-studio/test/meta-designers.test.tsx` | pass |
| `services/cmp-033-metadata/test/unit/kinds-payload.test.ts` | pass (optional content_hash pins) |
| typecheck studio-designers / web-studio / cmp-033 | pass (logs in this folder) |

E2E: `tests/e2e/studio-meta-designers.spec.ts` (axe on fee landing + template open paths) — run in CI Playwright suite.

## Honesty

- Agents do not self-certify. CERTIFIED=false. G6=false.
- SAMPLE_LAB_DUMMY fee/evidence/credential overlays are labeled non-statutory.
- DigiLocker remains SIM on lab path; REAL connector owner-held.
