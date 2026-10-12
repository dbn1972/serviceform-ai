# Tree fidelity (SF-M06-STITCH-B)

Payment trees already on `origin/main` via #125. STITCH-B did **not** modify `services/cmp-021-payment/**` or `db/migrations/*_cmp-021-*.sql`.

| Path | Relative to frozen input `ca80568f…` / main tip `a514ea9b…` |
|---|---|
| `services/cmp-021-payment/**` | **BYTE_IDENTICAL** (unchanged by stitch) |
| `db/migrations/1759620210000_cmp-021-payment.sql` | **BYTE_IDENTICAL** |
| `db/migrations/1759620210001_cmp-021-outbox.sql` | **BYTE_IDENTICAL** |
| `pnpm-lock.yaml` | Empty importer admitted only (`+2/−0`) |
