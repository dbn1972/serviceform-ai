# M05 lockfile ownership

Follow `orchestrator/dispatch/LOCKFILE-POLICY.md`. Do **not** weaken `--frozen-lockfile`, gitleaks, Semgrep, CodeQL, uniqueness, or supply-chain (`minimumReleaseAge`, `trustPolicy`, `blockExoticSubdeps`).

Builders, host, INT, SEC, and EVD **must not** commit `pnpm-lock.yaml`.

| Envelope | Lockfile |
|---|---|
| SF-M05-CG-001 | No lockfile (contracts only, later) |
| SF-M05-001 … 004 | Restore dirty lockfile before commit |
| SF-M05-STITCH-A | **Sole Wave A lockfile writer** after immutable Wave A heads (LOCK-4); may mechanically touch Wave A service/migration paths **only** |
| SF-M05-005 … 008 | Restore dirty lockfile before commit |
| SF-M05-STITCH-B | **Sole Wave B lockfile writer** after immutable Wave B heads (LOCK-6); Wave B trees **only** |
| SF-M05-009 / INT / SEC / EVD | No lockfile writes |

Frozen-lockfile CI red on isolated component PRs is expected until the matching stitch lands. That red is not a builder defect and is not fixed by committing `pnpm-lock.yaml` on the component PR.
