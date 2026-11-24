# SF-WC-FORMS-07 — World-class forms Measure (Workstream 7)

**Verdict:** instrumented + smoke PASS — **CERTIFIED=false** · **G6=false** · **self_certified=false**

| Field | Value |
|---|---|
| Tip | `356de377486856d10949c59f310ef5fe0c75acb4` (`cursor/world-class-forms-measure-ad53`) |
| Workstream | 7 Measure (authoring time, completion/abandon, a11y, p95, zero cross-tenant KPI) |
| Components | CMP-047 (observability), citizen BFF, Studio forms designer, CMP-009 path (hooks only) |
| Scope | Observability only — no authz/RLS/security weakening |
| PII | Forbidden on product-metric dimensions; redacted / UNCLASSIFIED |

## Capture points

| Signal | Where |
|---|---|
| Studio authoring session / milestones / duration | `apps/web-studio/components/forms/FormDesigner.tsx`, `DesignerPublish.tsx` |
| Citizen load / step / submit / complete / abandon | `apps/web-citizen/components/MetadataApplyForm.tsx` |
| BFF p95 inputs (Server-Timing + metric events) | `apps/web-citizen/app/api/portal/forms/[catalogueId]/route.ts`, `applications/route.ts` |
| A11y score hook | `recordA11yScore` + optional `window.__SF_A11Y_SCORE__` on citizen apply |
| Zero cross-tenant KPI | `ZERO_CROSS_TENANT_KPI` + smoke invariant `CROSS_TENANT_LEAKAGE=0` |

## How to re-run

```bash
node scripts/ci/forms-world-class-metrics-smoke.mjs
# or
pnpm exec vitest run packages/observability/test/product-metrics.test.ts \
  packages/observability/test/forms-metrics-smoke.test.ts \
  packages/observability/test/server-product-metrics.test.ts
```

Baseline artifact: `evidence/SF-WC-FORMS-07/smoke-baseline.json` (written by smoke test).

## Gate recommendation

Recommend **DEVELOPED** for measure instrumentation. Human/CI may mark verified after reviewing evidence. **Do not CERTIFY** from this package alone.
