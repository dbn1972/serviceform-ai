# Residuals (SF-M06-STITCH-B)

| Residual | Status | Note |
|---|---|---|
| Lockfile importer `services/cmp-021-payment` | **CLOSED** | Empty importer admitted |
| CMP-020 tip-count `migrateDown(2)` on combined tip | **CARRIED / EXPECTED** | Fails when CMP-021 is migration tip; CMP-020 was green at STITCH-A tip; CMP-021 tip migrateDown **PASS**; do not patch product logic in STITCH-B |
| REAL PSP / SMS / EMAIL gateways | **DEFERRED** | SIMULATED only; host SF-M06-005 may mount SIMULATED connectors |
| CERTIFIED / G3 / G6 | **false** | Not claimed |
