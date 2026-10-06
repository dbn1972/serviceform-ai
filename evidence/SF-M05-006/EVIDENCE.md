# SF-M05-006 evidence (CMP-019)

Builder evidence only. Not CERTIFIED. Not G4. Not G6. Do not merge. Do not start STITCH-B.

| Field | Value |
|---|---|
| Task | SF-M05-006 |
| Component | CMP-019 |
| PR | https://github.com/dbn1972/serviceform-ai/pull/97 (draft) |
| Branch | `agent/M05-deficiency-SF-M05-006` |
| Dispatch base | `ca57057a794739c03d0a46886577e25adf041815` |
| Dispatch authorized | true |
| Local unit+contract | 18/18 PASS |
| Typecheck | PASS |
| PostgreSQL integration | CI `migrations and tenant-isolation harness` PASS (this VM has no Postgres) |
| Lockfile | restored; not committed |
| CCR | false |

Exact-head CI on `3867cd45c80d08888c97f7665179de5d341464dc` (pre-handover freeze): ci quality PASS (`37463861025`), security PASS (`37463860894`), developer-platform PASS (`37463860860`). M01 envelope INT PASS. Semgrep PASS after SQL SELECT list fix.

See `junit/unit.xml`.
