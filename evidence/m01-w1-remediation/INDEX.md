# M01 Wave 1 remediation evidence index

**Status: AWAITING_GITHUB_EXECUTION** — not VERIFIED, not CERTIFIED.

This index binds envelope integration evidence to the **GitHub-executed remediation candidate SHA** only.
Cursor-host captures under `evidence/SF-M01-00{1..5}/` are **SUPERSEDED** (see each task `SUPERSEDED.md`).

| Field | Value |
|---|---|
| Remediation branch | `cursor/m01-w1-remediation-r1` |
| Draft PR | https://github.com/dbn1972/serviceform-ai/pull/22 |
| Baseline (immutable, PR #21) | `d33601a5c2c332548530897df1bd35702317df44` |
| Evidence commit (this index) | _filled after first remediation push_ |
| GitHub run ID | _filled after `m01-envelope-int` job completes_ |
| Artifact name | `m01-envelope-int-<sha>` |
| Summary schema | `serviceform.m01.envelope-int.summary.v1` |

## Required GitHub-executed suites

| Task | Component | Suites (must execute on GitHub) |
|---|---|---|
| SF-M01-001 | CMP-002 | privilege-boundary LOGIN, RLS negative, cross-component SQL denial, failure paths, envelope-int |
| SF-M01-002 | CMP-048 | privilege-boundary, RLS negative, OPA PEP fail-closed, `opa test`, envelope-int |
| SF-M01-003 | CMP-031 | privilege-boundary, tamper/failure paths, envelope-int |
| SF-M01-004 | CMP-038 | privilege-boundary, outbox atomicity, inbox/idempotency, retry/DLQ, Kafka real-broker K1–K5, broker outage/recovery, no-lost-committed-event, envelope-int |
| SF-M01-005 | CMP-037 | privilege-boundary, failure paths / duplicate-callback, envelope-int |

## Machine-readable artifacts (from GitHub job `m01-envelope-int`)

Uploaded path root: `test-results/m01-envelope-int/`

- `summary.json` — SHA, run ID, job, timestamp, suite, result, task/component IDs
- `ARTIFACT-INDEX.json` — run binding
- `SF-M01-00x/*.meta.json` — per-suite metadata
- `SF-M01-00x/junit/*.xml` — JUnit
- `SF-M01-00x/privilege-boundary.log`, `rls-negative.log`, `opa-test-results.txt`, `broker-outage.log`, `outbox-atomicity.log`, `tamper-detection.log`, `duplicate-callback.log`
- `contracts/` — contract snapshot bundled with the run

## Provenance rule

Do **not** accept `hostname=cursor` JUnit/logs as final evidence.
Accept only artifacts from the GitHub Actions runner for the remediation SHA referenced above.
