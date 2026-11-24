# SF-P8-MEASURE — Path-to-8 P8-1 Durable Measure (D7)

**Verdict:** durable KPI series + panel + OTLP export + CI smoke PASS — **CERTIFIED=false** · **G6=false** · **self_certified=false** · DigiLocker **out of scope**

| Field | Value |
|---|---|
| Tip | `e95d190e01b083ad4128a5a4ef1983d7121d4f17` (`cursor/path8-measure-3743`) |
| Workstream | P8-1 Measure (raise D7 ~5→8) |
| Package | `@serviceform/forms-product-metrics` (web-safe; no `@serviceform/observability`) |
| Studio | `/forms/metrics` KPI panel |
| Admin | `/forms-kpi` read-only desk |
| Smoke | `node scripts/ci/forms-path8-measure-smoke.mjs` |
| Executed | load_p95=72 · submit_p95=97 · completes=126 · abandons=18 · windows=6 · cross_tenant=0 · markers=12 |

## What lifted D7 beyond WS7 synthetic

| Capability | Artifact |
|---|---|
| Multi-window lab_host_series (not only n=40 synthetic) | `durable-kpi-snapshot.json` |
| Funnel start→complete/abandon | snapshot `funnel` |
| Studio authoring duration p95 | snapshot `authoring` |
| Form load/submit p95 series | snapshot + per-window `series[]` |
| A11y score capture | snapshot `a11y` |
| Zero cross-tenant KPI + CI markers | `CROSS_TENANT_LEAKAGE=0` |
| OTLP-shaped export (PII-denied) | `otlp-export-sample.json` |
| deps:graph safety | web apps import forms-product-metrics only |

## How to re-run

```bash
node scripts/ci/forms-path8-measure-smoke.mjs
pnpm deps:graph
```

## Gate recommendation

Recommend **DEVELOPED** / evidence-ready for D7 reviewer lift. Human/CI may mark verified after reviewing this folder. **Do not CERTIFY**. DigiLocker remains out of scope.
