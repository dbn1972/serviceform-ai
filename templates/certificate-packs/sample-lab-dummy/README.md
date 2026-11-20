# SAMPLE_LAB DUMMY owner-config defaults

**Stamp:** `SAMPLE_LAB DUMMY` · `not_for_production` · `not_statutory` · `CERTIFIED=false` · `G6=false`

Shared synthetic defaults for Certificate stubs so Studio can configure packs without inventing
real statute. **Owner must replace before any non-lab / production use.**

| File | Role |
| --- | --- |
| `defaults.json` | Shared dummy values (fee, SLA, eligibility, evidence, jurisdiction, …) |
| `tenant-overlay.schema.json` | Per-tenant / TSB / jurisdiction override shape (CMP-052) |
| `../owner-config.schema.json` | Full owner-config schema (defaults + per-id + overlays validate against) |

## Merge order (tenant-wise, not global hardcode)

1. `defaults.json` (shared SAMPLE_LAB DUMMY)
2. `templates/certificate-packs/<id>/owner-config.json` (per-catalogue-id overlay)
3. Tenant / TSB overlay conforming to `tenant-overlay.schema.json` (CMP-052 binding)

Runtime helper: `@serviceform/service-templates` → `resolveSampleLabOwnerConfig(...)`.
**Fail-closed** when `environment_label !== SAMPLE_LAB`.

Residence (`IND-SOC-002`) keeps its Odisha public-portal SAMPLE_LAB package — not these dummies.
