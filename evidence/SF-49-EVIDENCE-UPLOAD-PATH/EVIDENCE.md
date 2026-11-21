# SF-49 — Evidence upload on apply + deficiency (CMP-013)

**Stamp:** `CERTIFIED=false` · `G6=false` · `self_certified=false` · SAMPLE_LAB  
**Base:** SF-47 deficiency UI branch merged locally for complementary wiring  
**Commit (at evidence capture):** see git SHA of this PR tip

## What was verified

| Check | Result | Log |
|---|---|---|
| Citizen document helpers (fail-closed type/size, AVAILABLE gate, deficiency ref) | PASS (4) | `vitest-unit.log` |
| Citizen deficiency mapping + CMP-013 evidence_ref binding | PASS (4) | `vitest-unit.log` |
| Lab CMP-013 composition helpers (SIMULATED fixture + owner enrich) | PASS (2) | `vitest-unit.log` |
| `@serviceform/api` typecheck | PASS | local |
| `@serviceform/web-citizen` typecheck | PASS | local |

```text
pnpm exec vitest run \
  apps/web-citizen/test/documents.test.ts \
  apps/web-citizen/test/deficiency.test.ts \
  apps/api/test/document-upload-lab.test.ts
# Test Files  3 passed (3) · Tests  10 passed (10)
```

## Honest limits

- Object storage and malware scan remain **SIMULATED** (INT-013). Lab put/scan routes are LOCAL/CI only.
- CMP-013 `AVAILABLE` = technical accept only; officers still business-verify.
- Published Residence form schema is unchanged: `evidence_file_name` carries the CMP-013 document id after upload.
- Agents do **not** self-certify. **CERTIFIED=false. G6=false.**
