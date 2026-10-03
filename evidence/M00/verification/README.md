# M00 verification re-run

Run: Sat Oct  3 09:42:40 UTC 2026 on commit 488bed9, requested by the owner on 3 Oct 2026 ("please verify M00").
Every command was re-run from scratch; each log in this folder is the complete output. summary.tsv lists command and exit code (0 = pass).

## Folder mapping (checklist name -> repo path)
| Checklist | Repo path | Note |
|---|---|---|
| apps | apps/ | api, web-citizen, web-officer, web-studio, web-admin, mobile |
| services | services/ | placeholder README (no business services in M00) |
| packages | packages/ | contracts, observability, ui-ux4g |
| contracts | contracts/shared + packages/contracts | schemas + TypeScript validators |
| database | db/ | node-pg-migrate SQL migrations + RLS harness |
| policy | policy/opa | placeholder (OPA policies start in later milestones) |
| workflow | workflows/ | placeholder (Temporal workflows start later) |
| infra | infra/local, infra/terraform | |
| tests | tests/e2e, tests/semgrep, plus each package's test/ | |
| evidence | evidence/M00 | |
