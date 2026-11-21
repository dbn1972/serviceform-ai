# SAMPLE_LAB sample parameters (configurable)

**Stamp:** `SAMPLE_LAB DUMMY` · SAMPLE_LAB sample parameters · tenant-editable · not locked statute · `not_for_production` · `CERTIFIED=false` · `G6=false`

Shared **configurable SAMPLE_LAB sample parameters** for Certificate stubs so Studio can configure
packs in the lab. Defaults are starting values only — each tenant overrides via owner-config /
CMP-052 TSB overlays. Not locked fake statute.

| File | Role |
| --- | --- |
| `defaults.json` | Shared SAMPLE_LAB sample parameters (fee, SLA, eligibility, evidence, jurisdiction incl. sample LGD `allowed_states` / `allowed_districts`, …) |
| `tenant-overlay.schema.json` | Per-tenant / TSB / jurisdiction override shape (CMP-052) — may override allowed state/district LGD codes |
| `../owner-config.schema.json` | Full owner-config schema (defaults + per-id + overlays validate against) |

## Merge order (tenant-wise, not global hardcode)

1. `defaults.json` (shared SAMPLE_LAB sample parameters)
2. `templates/certificate-packs/<id>/owner-config.json` (per-catalogue-id overlay)
3. Tenant / TSB overlay conforming to `tenant-overlay.schema.json` (CMP-052 binding)

Runtime helper: `@serviceform/service-templates` → `resolveSampleLabOwnerConfig(...)`.
**Fail-closed** when `environment_label !== SAMPLE_LAB`.

Residence (`IND-SOC-002`) keeps its Odisha public-portal SAMPLE_LAB package — not these sample defaults.
