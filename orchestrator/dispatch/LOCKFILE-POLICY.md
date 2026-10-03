# Lockfile ownership (M01 Wave 1)

`pnpm-lock.yaml` is **not** a builder write path.

- Builders may change `package.json` (and other manifests) only inside `allowed_write_paths` when the task needs a dependency.
- Builders must not commit `pnpm-lock.yaml`. If `pnpm install` dirties it, restore it before commit.
- `check_scope.py` always refuses `pnpm-lock.yaml` on `agent/*` branches.
- Root `pnpm-workspace.yaml` stays read-only for Wave 1 (`services/*` / `packages/*` already include new component packages).
- **Orchestrator/integration** regenerates one canonical lockfile. Builders do not weaken `--frozen-lockfile`, gitleaks, Semgrep, CodeQL, or audit jobs.

## Isolated Wave 1 PRs (expected)

Frozen-lockfile CI (`pnpm install --frozen-lockfile` in `ci.yml` quality/database/ui-smoke and `security.yml` dependency audit) **fails on isolated `agent/M01-*` PRs** until that PR's new workspace importers exist in the lockfile on the same tree.

That red is **not** a builder defect and is **not** fixed by committing `pnpm-lock.yaml` on the component PR. A builder cannot admit only its own importers: the lockfile is repo-global, and `check_scope.py` forbids other components' manifests.

Do **not** skip or loosen frozen-lockfile, gitleaks `fetch-depth: 0`, Semgrep, or audit to make isolated PRs green.

Gitleaks with `fetch-depth: 0` scans reachable history across refs. Hits in `packages/security/test/*.ts` belong to SF-M01-002 (CMP-048), not to CMP-002.

## Canonical lockfile branch

Branch: `cursor/m01-w1-lockfile-b828` (base `origin/main` `8a4695d`).

Admitted importers (tips at regen):

| Task | SHA | Importers |
|---|---|---|
| SF-M01-001 | `34262a3` | `services/cmp-002-tenant-organisation/package.json` |
| SF-M01-002 | `b8a8dd9` | `packages/security/package.json`, `services/cmp-048-security-platform/package.json` |
| SF-M01-003 | `c28f6d9` | `packages/audit-client/package.json`, `services/cmp-031-audit-ledger/package.json` |
| SF-M01-005 | `b574b2d` | `packages/connector-sdk/package.json`, `services/cmp-037-integration-hub/package.json` |

Regen used Node 22.22.2 and a one-shot `minimumReleaseAge=0` so new importers could depend on `pg@8.23.1` already pinned on main (published 2026-09-30, younger than the 7-day workspace cooldown). The committed `pnpm-workspace.yaml` cooldown and `trustPolicy: no-downgrade` are unchanged. Lockfile delta is importer entries only (no version bumps).

**Do not merge this lockfile PR to `main` yet.** It carries manifests without component source; typecheck/build on this branch are not a Wave 1 gate. Do not merge builder PRs. Do not start Wave 2.

## SF-M01-004 not admitted

`packages/outbox` (`@platformatic/kafka@2.12.1`) is **not** in this lockfile. `pnpm` `trustPolicy: no-downgrade` refuses transitive `@platformatic/wasm-utils@0.2.1` (earlier versions had trusted publisher; 0.2.1 has none). Do not disable `trustPolicy` or security jobs to admit it. CMP-038 must change client or raise an owner exception before a later lockfile regen includes 004.

## Later integration (not this step)

1. 002 remediates gitleaks fixtures (historical scan stays on).
2. 004 resolves kafka/wasm-utils trust or files a CCR/exception.
3. Rebuild the canonical lockfile from all five **then-current** `package.json` tips onto an integration branch that also contains component source.
4. Run `pnpm install --frozen-lockfile` plus tests on that integration tree.
5. Only then consider merges to `main`.
