# P8-6 Golden-2 — config-only second service (DRAFT/DUMMY ceiling)

**Stamp:** SAMPLE_LAB · DigiLocker **SIMULATED** (REAL **out of scope**) · **CERTIFIED=false · G6=false · self_certified=false · TSB_seal(G6)=false**  
**Tip:** `a0bfdc76cb0a0f4ce0d160665eb97e21e7df3185` (`a0bfdc76`) — suites executed on `4f7ff354` (no product runtime delta in this tip)
**Executed:** 2026-11-25 00:22 Asia/Calcutta (IST)  
**Re-run:** `scripts/dev/p8-golden2-evidence.sh` (requires `platform-lab.sh up`)

## Mission

1. Hold **Residence Certificate (IND-SOC-002)** Golden path on Studio metadata only.
2. Prove **Income (IND-SOC-031)** second-service reuse at honest **DRAFT / SAMPLE_LAB DUMMY / lab-offer** ceiling.
3. Document **SF-33** as the **only** statutory **PUBLISH** blocker — no invented statute; Income not marked PUBLISHED.

## Executed results

| Suite | Artefact |
|---|---|
| Playwright (golden + M11/P8-6 + certificate representatives) | `logs/e2e-golden2.log`, `junit/` |
| `@serviceform/service-templates` catalogue + M11 dry-run + SF-33 gate | `logs/unit-templates.log` |
| `@serviceform/web-citizen` M11 Income gate | `logs/unit-citizen-income-gate.log` |

Stats from `summary.json`: e2e passed=42 failed=0.

## SF-33 PUBLISH blocker

See `fixtures/SF33_PUBLISH_BLOCKER.md` and `fixtures/sf33-publish-gate.json`.

| Field | Value |
|---|---|
| `statutory_publish` | **BLOCKED** |
| `publish_blocker` | **SF-33** |
| `statute_invented` | **false** |
| `income_marked_published` | **false** |

## Platform reuse

See `fixtures/PLATFORM_REUSE_GAP_LIST.md`. No new `services/**` Income backend. Closed CCR-M11-001 gaps remain reusable platform capabilities.

## Honesty

- CERTIFIED=false · G6=false · self_certified=false
- DigiLocker REAL out of scope for path-to-8
- Lab-offer ≠ statutory PUBLISHED
- Agents do not self-certify; independent reviewer owns D4 7→8 GO/NO-GO
