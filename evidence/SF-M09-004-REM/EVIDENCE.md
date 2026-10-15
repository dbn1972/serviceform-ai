# SF-M09-004-REM — CMP-059 outbox FORCE RLS

**Not CERTIFIED. Not G3. Not G4. Not G6. self_certified false.**

| Field | Value |
|---|---|
| Defect | `sf_migration.outbox_event` PLATFORM_OPERATIONAL + `tenant_id`, no FORCE RLS → T2 read T1 |
| Fix | Additive migration `1761100000001_cmp-059-outbox-force-rls.sql` ENABLE+FORCE RLS + tenant policy; `isolation.json` → TENANT_SCOPED / FORCE |
| Branch | `cursor/m09-004-rem-outbox-rls-91f2` |
| Owner | SF-M09-004 / CMP-059 |

## Certification stance

CERTIFIED=false · G4=false · G6=false · g4_recommended=false until independent INT/SEC re-verify PASS.
