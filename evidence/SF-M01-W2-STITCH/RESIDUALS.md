# SF-M01-W2-STITCH residuals

**Not CERTIFIED.** Residuals do not block `M01_WAVE2_STITCH_READY` unless noted.

| ID | Item | Severity | Notes |
|---|---|---|---|
| R-CI | Remote CI status on stitch PR | cleared | Tip `347fe74` — GitHub checks **15/15 SUCCESS** on draft PR #30 (docs bind may trail tip) |
| R-COV | Global unit coverage vs int-only routes | mitigated | Root vitest excludes CMP-003/030/032 route/repo/db/(032 service) + CMP-055 CLI from global thresholds; component coverage + `*.int.test.ts` remain authoritative |
| R-ENV-INT | GitHub `M01 envelope integration` job still W1-only | non-blocking | Job name/tasks remain `SF-M01-001..005` (see `.github/workflows/ci.yml`). Do **not** weaken that gate. Additive W2 envelope INT job is for INT/orchestrator (or CMP-055 if scoped); not claimed CERTIFIED here |
| R-INT | Independent integration verifier | expected | SF-M01-W2-INT — orchestrator owns dispatch after stitch |
| R-SEC | Independent security verifier | expected | SF-M01-W2-SEC still planning/not dispatched |
| R-EVD | Independent evidence verifier | expected | SF-M01-W2-EVD still planning/not dispatched |
| R-MIG-TS | Shared migration timestamp prefix `1759500600000` for cmp-003 and cmp-032 | non-blocking | Distinct filenames; `migration_lint` PASS; lexicographic order stable |
| R-RUNTIME | Default `apps/api` entry does not auto-wire pool/OPA | deferred | Optional `wave1` / `wave2` mounts; same Phase A design |
| R-INFRA | REAL S3/KMS/WAF | ADR later | CMP-032 remains SIMULATED/local |
| R-DPDP | Statutory DPDP anchors | ADR if needed | CMP-030 platform-only |
| R-OUTBOX | ADR-0006 #9 `sf_app` grants | optional CCR | Unchanged from Wave 1 residual |

Builder lockfile residuals on #26/#27/#28/#29 are **cleared on this stitch tree** by canonical `pnpm-lock.yaml` regen. Isolated builder PRs may still show outdated-lockfile red until stitch/main absorb the lockfile.
