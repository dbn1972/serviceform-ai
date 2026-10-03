# PR #6 security-gate remediation

**PR:** https://github.com/dbn1972/serviceform-ai/pull/6  
**Branch:** `cursor/m01-wave1-dispatch-b828`  
**Failed head:** `8e51979259cc91c7265a0a6cd88710b8087a81e7`  
**Remediation head (this document):** recorded after push; GitHub conclusions are the merge gate, not local scans.  
**Do not merge until gitleaks and Semgrep PASS on GitHub.** Builders not spawned.

Local tools used for diagnosis (not a green gate): gitleaks **8.30.1** (`gitleaks git` + `.gitleaks.toml --redact --exit-code 1`); semgrep **1.179.0** with `p/default`, `p/typescript`, `p/nodejsscan`, `p/secrets`, `.semgrep/`, `--exclude tests/semgrep`. CI image for gitleaks is `zricethezav/gitleaks:v8.30.1` (binary 8.30.1 equivalent; this environment has no Docker).

## Counts

| Scanner | Original blocking findings | REAL_SECRET / TRUE_POSITIVE | TEST_FIXTURE / FALSE_POSITIVE | NOT_APPLICABLE |
|---|---:|---:|---:|---:|
| gitleaks | 3 | 0 | 3 TEST_FIXTURE | 0 |
| Semgrep | 42 | 42 | 0 | 0 |

**Credentials requiring external rotation:** none.  
**Git history rewrite:** not required (no real secret). `gitleaks git` still sees commit `9947a9b`, so a **narrow** allowlist remains for those three fixture paths only.

## Gitleaks findings (secrets redacted)

CI command: `gitleaks git` (full history, `fetch-depth: 0`). Rule **not** disabled.

| # | Rule ID | Path | Location | Classification | Remediation |
|---|---|---|---|---|---|
| 1 | `generic-api-key` | `contracts/shared/examples/valid/outbox-record.json` | line 6, commit `9947a9bcf72e` (CR-001) | TEST_FIXTURE | Replace HEAD `partition_key` / high-entropy example UUIDs with synthetic placeholders (`example-partition-key`, repeating-digit UUIDs). Narrow history allowlist (below). |
| 2 | `generic-api-key` | `contracts/shared/examples/invalid/outbox-record.camel-case-envelope.json` | line 6, commit `9947a9bcf72e` | TEST_FIXTURE | Same as #1. |
| 3 | `generic-api-key` | `contracts/shared/examples/invalid/outbox-record.dead-letter-without-error.json` | line 6, commit `9947a9bcf72e` | TEST_FIXTURE | Same as #1. |

Matched field: `partition_key` (JSON). Detected value class: RFC4122 UUID (entropy ~3.84). **Value: [REDACTED].** Published SF-CON-OUTBOX example identifier, not a credential/token/key. Schema allows any string for `partition_key`; `aggregate_id` remains a UUID.

**Allowlist (established `.gitleaks.toml` `[[allowlists]]` only; not a global rule disable):**

- id: `sf-con-outbox-example-rfc4122-ids`
- `targetRules = ["generic-api-key"]`
- `condition = "AND"`
- exact paths: the three files above
- regex: RFC4122 UUID shape only

A non-UUID secret in those files, or a UUID-shaped `generic-api-key` hit anywhere else, still fails. The previous broad `contracts/shared/examples/` path allowlist was removed.

Lockfile allowlist (`generated-lockfiles`) is unchanged in purpose (pre-existing M00).

## Semgrep triage matrix

All 42 were **TRUE_POSITIVE** supply-chain defects on files still present on this branch (originated on main/M00). No rule suppressions. Blocking severity unchanged.

| Rule ID | Severity | Files (lines) | Issue type | Class | Remediation |
|---|---|---|---|---|---|
| `yaml.github-actions.security.github-actions-mutable-action-tag` | WARNING (blocking under `--error`) | `.github/workflows/ci.yml` 31,32,34,44,57,59,73,94,95,98,100,110,111,113,119,130,131,143,150; `.github/workflows/security.yml` 20,27,36,43,54,55,57,63,64,66,75,86,87 (32 hits) | Mutable Actions tag/branch (`@vN`) | TRUE_POSITIVE | Pin every `uses:` to the 40-character commit SHA of the then-current major tag. Comment retains the tag for humans. |
| `package_managers.dependabot.dependabot-missing-cooldown` | MEDIUM | `.github/dependabot.yml` 3,11,14,17,20,23 (6 ecosystems) | No Dependabot cooldown | TRUE_POSITIVE | `cooldown: { default-days: 7 }` on each `package-ecosystem`. |
| `package_managers.npm.npm-missing-minimum-release-age` | MEDIUM | `.npmrc` 1 | No npm minimum release age | TRUE_POSITIVE | `min-release-age=7` (days; npm >=11.10). |
| `package_managers.pnpm.pnpm-block-exotic-sub-dependencies` | MEDIUM | `pnpm-workspace.yaml` 2 | Missing `blockExoticSubdeps` | TRUE_POSITIVE | `blockExoticSubdeps: true` (pnpm >=10.26). |
| `package_managers.pnpm.pnpm-minimum-release-age` | MEDIUM | `pnpm-workspace.yaml` 2 | Missing `minimumReleaseAge` | TRUE_POSITIVE | `minimumReleaseAge: 10080` (minutes = 7 days). |
| `package_managers.pnpm.pnpm-trust-policy` | MEDIUM | `pnpm-workspace.yaml` 2 | Missing `trustPolicy` | TRUE_POSITIVE | `trustPolicy: no-downgrade`. |

Action SHAs pinned (tag at pin time):

| Action | Tag | SHA |
|---|---|---|
| `actions/checkout` | v5 | `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` |
| `pnpm/action-setup` | v4 | `b906affcce14559ad1aafd4ab0e942779e9f58b1` |
| `actions/setup-node` | v5 | `a0853c24544627f65ddf259abe73b1d18a591444` |
| `actions/upload-artifact` | v4 | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
| `actions/setup-python` | v6 | `ece7cb06caefa5fff74198d8649806c4678c61a1` |
| `github/codeql-action` (init + analyze) | v3 | `1190a975f95ce23525efb6a3fc21ea29567c1b52` |
| `subosito/flutter-action` | v2 | `1a449444c387b1966244ae4d4f8c696479add0b2` |
| `hashicorp/setup-terraform` | v3 | `b9cd54a3c349d3f38e8881555d616ced269862dd` |

On GitHub head `804d310` (first remediations, **before** this narrower gitleaks pass): Semgrep job **SUCCESS**. That is not sufficient for merge until the latest commit’s full required checks pass.

## Residual risk

- Historical RFC4122 example IDs remain in git object `9947a9b`. They are not credentials. Allowlist is path+rule+UUID AND.
- Action pins must be refreshed via Dependabot `github-actions` (7-day cooldown).
- Seven-day package cooldown/release-age can delay uptake of emergency dependency fixes; owners can still bump manually.
- Frozen contract **schema hashes** unchanged. Example JSON files are not lock companions.

## GitHub job conclusions

Filled after required checks complete on the remediation head. Local gitleaks 0 / local Semgrep 0 are **not** the gate.

| Workflow / job | Conclusion on failed head `8e51979` | Conclusion on latest head |
|---|---|---|
| ci / format, lint, typecheck, unit, contracts, build | SUCCESS | pending |
| ci / architecture gates | SUCCESS | pending |
| ci / migrations and tenant-isolation harness | SUCCESS | pending |
| ci / web shells smoke and accessibility | SUCCESS | pending |
| ci / flutter analyze and test | SUCCESS | pending |
| ci / workflows, compose and terraform validation | SUCCESS | pending |
| security / dependency audit | SUCCESS | pending |
| security / IaC scan (checkov) | SUCCESS | pending |
| security / SAST (CodeQL) | SUCCESS | pending |
| security / secret scan (gitleaks) | **FAILURE** | pending — must PASS |
| security / SAST (semgrep) | **FAILURE** | pending — must PASS (`804d310` was SUCCESS; new head must re-run) |
