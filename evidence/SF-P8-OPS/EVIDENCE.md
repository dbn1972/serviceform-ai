# P8-5 Ops depth — D6 7→8 (DigiLocker out of scope)

**Stamp:** `CERTIFIED=false` · `G6=false` · `self_certified=false` · DigiLocker **out of scope**  
**Branch:** `cursor/path8-ops-depth-b38f`  
**Tip (restamp):** `ddc2ddcb` (`ddc2ddcb90aa055513a48dd564f1c96c6ea4c1a0`) — reachable tip named by residual; chore commit may sit above
**Scope:** Maker≠checker UX, deficiency loop decide-block, SLA breach visibility, TSB pin integrity cues, CMP-015 audit depth + sanitize, officer SF-TEN-002 on task queue.

## What landed

| Area | Change |
|---|---|
| Maker-checker | Admin `makerCheckerUx` returns `SAME_PRINCIPAL` / role / status block reasons; ReviewDesk alerts; reviews page copy |
| Deficiency loop | `deficiency-view` phases + timeline; decide blocked while OPEN (banner + footer) |
| SLA breach | `hasSlaBreach` / `slaBreachSummary` / warning visibility on officer case |
| TSB pin clarity | `pinIntegrityCue` — silent_repoint_forbidden, required pins, hash present, **tsb_immutability_sealed=false** |
| Audit trail | Depth counters, correlation short-id, BFF `sanitizeAuditRow` defence-in-depth |
| Tenant fail-closed | `tenantIdentifyingRefusal` on `/api/portal/tasks` + claim (plus existing case routes) |

## Avoided

- Citizen form chrome
- Studio form designer canvas
- DigiLocker REAL / connector mode flips
- Claiming G6 TSB seal or CERTIFIED

## Executed checks

| Check | Result |
|---|---|
| `vitest` officer ops-depth + deficiency + sla + admin maker-checker + markup | **33 PASS** |
| `pnpm --filter @serviceform/web-officer typecheck` | PASS |
| `pnpm --filter @serviceform/web-admin typecheck` | PASS |

Logs: `vitest-unit.log`, `junit/unit.xml`, `typecheck-officer.log`, `typecheck-admin.log`.

## Gate recommendation

Builder evidence only. Human/CI may merge when CI green. Independent reviewer owns D6 7→8. **Do not** claim CERTIFIED or G6.
