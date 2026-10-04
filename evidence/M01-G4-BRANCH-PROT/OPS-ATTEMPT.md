# R-BRANCH-PROT ops attempt (agent)

**Date:** 2026-10-04  
**Agent:** bc-381e3b01-e75a-5481-a04d-3bbeffa1a3af  
**Baseline tip:** `436c3545cf31bc3a8ba9aaacfcb0b888a168bd90`  
**Result:** **NOT ENABLED** — GitHub App / integration token lacks `Administration` permission.

## API probes (no secrets)

| Call | HTTP | Observation |
|---|---|---|
| `GET .../branches/main` | 200 | `protected: false`, sha `436c354…` |
| `GET .../branches/main/protection` | 403 | Resource not accessible by integration |
| `PUT .../branches/main/protection` | 403 | Cannot enable classic protection |
| `GET .../rulesets` | 200 | `[]` (no rulesets) |
| `POST .../rulesets` | 403 | Cannot create ruleset |
| `GET .../branches/main/rules` | 404 | No branch rules |
| Repo `permissions` via API | — | `admin/maintain/push/pull/triage: false` |

## Required check contexts to configure (from tip check-runs)

Workflow names (`ci`, `security`, `developer-platform`) are **not** themselves required-check contexts. Require these **job/check-run names**:

### ci
- `format, lint, typecheck, unit, contracts, build`
- `architecture gates`
- `migrations and tenant-isolation harness`
- `M01 envelope integration (W1+W2 all CMPs)`
- `web shells smoke and accessibility`
- `flutter analyze and test`
- `workflows, compose and terraform validation`

### security
- `secret scan (gitleaks)`
- `SAST (semgrep)`
- `SAST (CodeQL)`
- `dependency audit`
- `IaC scan (checkov)`

### developer-platform
- `CMP-055 unit tests`
- `CMP-055 additive gates`

## Disposition

R-BRANCH-PROT remains **OPS_CONFIRM** until a human/repo admin enables protection and verifies in UI.  
Do **not** issue `M01_COMPLETE_G4_SECURITY_VERIFIED` from this attempt. Not CERTIFIED. M02/M03/CG-01 remain blocked.

Store companion: `/cursor/stores/bc-1e78e82c-97d0-4244-ab49-3bcc7891e193/docs/m01-g4-branch-protection.md`
