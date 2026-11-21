# SF-42 Tenant jurisdiction scope — evidence

**Stamp:** `CERTIFIED=false` · `G6=false` · `self_certified=false` · SAMPLE_LAB  
**Scope:** All Certificate + Licence + Permit (+ Birth Registration) catalogue offerings  
**Commit:** recorded at evidence capture time (see `git rev-parse HEAD` in logs)

## What was verified (executed)

| Check | Result |
| --- | --- |
| `packages/service-templates/test/catalogue.test.ts` | PASS |
| `packages/service-templates/test/lab-offer-sample-data.test.ts` | PASS |
| `packages/service-templates/test/jurisdiction-scope.test.ts` | PASS |
| `services/cmp-009-dynamic-forms/test/unit/certificate-catalogue-forms.test.ts` | PASS (215) — LGD pattern inside CMP-009 subset |
| `apps/web-admin/test/markup.test.tsx` | PASS |
| Totals | see latest `junit/unit.xml` |

Artifacts: `junit/unit.xml`, `logs/unit.log`.

## Capabilities under test

- Owner-config / tenant overlay slots `jurisdiction.allowed_states[]` / `allowed_districts[]` / `allowed_municipalities[]`
- Fail-closed empty lists outside SAMPLE_LAB; SAMPLE_LAB sample LGD set (incl. ULB/local-body)
- Form schema enum constraint via semantic ids (`SF-SEM-ADDR-MUNICIPALITY`)
- Admin Bindings jurisdiction desk (any catalogue id, incl. IND-ULB-*)
- Licence (44) + Permit (11) stubs/packs included in catalogue

## Not claimed

- CERTIFIED / G6 / self-certification
- Production national LGD master sync
- Citizen-offerable Licence/Permit without PUBLISHED TSB + placement
