# M01 Wave 1 remediation evidence index

**Status: GITHUB_EXECUTED / R4_COMPLETE** — not VERIFIED, not CERTIFIED.

This index binds envelope integration evidence to the **GitHub-executed remediation candidate SHA** only.
Cursor-host captures under `evidence/SF-M01-00{1..5}/` are **SUPERSEDED** (see each task `SUPERSEDED.md`).

| Field | Value |
|---|---|
| Remediation branch | `cursor/m01-w1-remediation-r1` |
| Draft PR | https://github.com/dbn1972/serviceform-ai/pull/22 |
| Baseline (immutable, PR #21) | `d33601a5c2c332548530897df1bd35702317df44` |
| Frozen verification candidate SHA | `7a571ced96a233f9f233b7af730e4645dccbd1a4` |
| Prior green tip | `1c7de49d6ab2df3d2140d5177aa414804631a688` |
| GitHub ci run | [37163807120](https://github.com/dbn1972/serviceform-ai/actions/runs/37163807120) **SUCCESS** |
| GitHub security run | [37163807119](https://github.com/dbn1972/serviceform-ai/actions/runs/37163807119) **SUCCESS** |
| Checks | 13/13 SUCCESS |
| Artifact name | `m01-envelope-int-d270a4fc51ca317062d14127a53bba419e87b341` |
| Summary schema | `serviceform.m01.envelope-int.summary.v1` |
| Full evidence doc | `docs/verification/M01-WAVE1-REMEDIATION-EVIDENCE.md` |

## Required GitHub-executed suites

| Task | Component | Suites (executed on GitHub) |
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
- Named logs: privilege-boundary, rls-negative, opa-test-results, broker-outage, outbox-atomicity, tamper-detection, duplicate-callback
- `contracts/` — contract snapshot bundled with the run

## Provenance rule

Do **not** accept `hostname=cursor` JUnit/logs as final evidence.
Accept only artifacts from the GitHub Actions runner for SHA `7a571ced96a233f9f233b7af730e4645dccbd1a4` (runs above).
