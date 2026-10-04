# M04 lockfile ownership

Follow `orchestrator/dispatch/LOCKFILE-POLICY.md`. Builders (SF-M04-001 … 007, INT, SEC, EVD) **must not** commit `pnpm-lock.yaml`.

| Envelope | Lockfile |
|---|---|
| SF-M04-001 … 004 | Restore dirty lockfile before commit |
| SF-M04-STITCH-A | **Sole Wave A lockfile writer** after immutable Wave A heads (LOCK-3); may mechanically touch Wave A service/migration paths |
| SF-M04-005, SF-M04-006 | Restore dirty lockfile before commit |
| SF-M04-STITCH-B | **Sole Wave B lockfile writer** after immutable Wave B heads (LOCK-7) |
| SF-M04-007 / INT / SEC / EVD | No lockfile writes |

Frozen-lockfile CI red on isolated component PRs is expected until the matching stitch lands. Do not weaken `--frozen-lockfile`, gitleaks, Semgrep, CodeQL, or uniqueness.
