# M07 envelope summary (PLANNING; freeze/builders OFF)

Machine-readable copies: `orchestrator/handovers/SF-M07-*.yaml` and `orchestrator/tasks/` mirrors. Plan: `docs/planning/M07-PLAN.md`.

## Normative topology

PLANNING → SF-M07-CG-001 freeze (**OFF**) → Wave A `001∥002∥003∥004` (**OFF**) → STITCH-A → STITCH-B → `005` host → `INT∥SEC` → EVD recommend G3 → human G3 later.

## Path uniqueness (Wave A)

| Envelope | CMP | `allowed_write_paths` (product) | Schema / role |
|---|---|---|---|
| SF-M07-001 | CMP-022 Credential Engine | `services/cmp-022-credential-engine/**`, `db/migrations/*_cmp-022-*.sql` | `sf_credential` / `sf_cmp022_rw` |
| SF-M07-002 | CMP-024 Registry/Revocation | `services/cmp-024-credential-registry/**`, `db/migrations/*_cmp-024-*.sql` | `sf_credential_registry` / `sf_cmp024_rw` |
| SF-M07-003 | CMP-023 QR Verification | `services/cmp-023-qr-verification/**`, `db/migrations/*_cmp-023-*.sql` | `sf_qr` / `sf_cmp023_rw` |
| SF-M07-004 | CMP-012 DigiLocker | `services/cmp-012-digilocker/**`, `db/migrations/*_cmp-012-*.sql` | `sf_digilocker` / `sf_cmp012_rw` |

All envelopes also write only their own `evidence/SF-M07-00N/**` and handover. No `pnpm-lock.yaml`, `contracts/**`, or `apps/**` for builders.

## Envelopes

| ID | Purpose | Wave / lock | This package |
|---|---|---|---|
| SF-M07-CG-001 | NEW M07 contract freeze | LOCK-2 | PLANNING (`freeze_authorized: false`) |
| SF-M07-001 | CMP-022 Credential Engine | A / LOCK-3 | PLANNING |
| SF-M07-002 | CMP-024 Registry/Revocation | A / LOCK-3 | PLANNING |
| SF-M07-003 | CMP-023 QR Verification | A / LOCK-3 | PLANNING |
| SF-M07-004 | CMP-012 DigiLocker Connector | A / LOCK-3 | PLANNING |
| SF-M07-STITCH-A | Wave A mechanical stitch | LOCK-4 | PLANNING |
| SF-M07-STITCH-B | lockfile admit remaining | LOCK-6 | PLANNING |
| SF-M07-005 | API host M07 mounts | LOCK-7 | PLANNING |
| SF-M07-INT | INT-008 + INT-011/013 | LOCK-8 | PLANNING |
| SF-M07-SEC | independent security | LOCK-8 | PLANNING |
| SF-M07-EVD | recommend G3 only | LOCK-9 | PLANNING |
