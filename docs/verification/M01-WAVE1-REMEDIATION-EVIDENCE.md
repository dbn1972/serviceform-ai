# M01 Wave 1 remediation evidence

**R4_COMPLETE** — not VERIFIED, not CERTIFIED. Do not merge. No Wave 2. Independent verifiers not started by this lane.

| Field | Value |
|---|---|
| Remediation branch | `cursor/m01-w1-remediation-r1` |
| Draft PR | https://github.com/dbn1972/serviceform-ai/pull/22 |
| Baseline (PR #21, frozen / untouched) | `d33601a5c2c332548530897df1bd35702317df44` |
| Frozen verification candidate SHA | `7a571ced96a233f9f233b7af730e4645dccbd1a4` |
| Prior green tip (envelope-ready) | `1c7de49d6ab2df3d2140d5177aa414804631a688` |
| GitHub ci (candidate) | [37163807120](https://github.com/dbn1972/serviceform-ai/actions/runs/37163807120) **SUCCESS** |
| GitHub security (candidate) | [37163807119](https://github.com/dbn1972/serviceform-ai/actions/runs/37163807119) **SUCCESS** |
| Checks | **13/13 SUCCESS** |
| Envelope INT artifact | `m01-envelope-int-d270a4fc51ca317062d14127a53bba419e87b341` |
| Handovers | `orchestrator/handovers/SF-M01-00{1..5}.yaml` (`result_commit` / `tested_commit` = candidate; `blocked_ci: false`) |
| Evidence index | `evidence/m01-w1-remediation/INDEX.md` |
| Cursor-host SF-M01-00x | **SUPERSEDED** (not VERIFIED) |

## Policy note

Tip `7a571ce` is the handover-bind commit on top of green `1c7de49`. GitHub re-executed full ci+security (including `m01-envelope-int`) on `7a571ce` with 13/13 SUCCESS. Frozen verification candidate = **`7a571ce`**.

## Jobs (ci 37163807120)

| Job | Result |
|---|---|
| format, lint, typecheck, unit, contracts, build | SUCCESS |
| architecture gates | SUCCESS |
| migrations and tenant-isolation harness | SUCCESS |
| M01 envelope integration (SF-M01-001..005) | SUCCESS |
| web shells smoke and accessibility | SUCCESS |
| flutter analyze and test | SUCCESS |
| workflows, compose and terraform validation | SUCCESS |

## Security (37163807119)

| Job | Result |
|---|---|
| secret scan (gitleaks) | SUCCESS |
| SAST (semgrep) | SUCCESS |
| SAST (CodeQL) / CodeQL | SUCCESS |
| dependency audit | SUCCESS |
| IaC scan (checkov) | SUCCESS |

## Envelope INT coverage (SF-M01-001..005)

Executed on GitHub job `m01-envelope-int` for the candidate SHA:

- privilege-boundary LOGIN
- RLS negative / cross-component SQL denial
- OPA (`opa test` + PEP fail-closed)
- Kafka real-broker K1–K5, broker outage/recovery
- outbox atomicity, inbox/idempotency, retry/DLQ, no-lost-committed-event
- failure paths / tamper / duplicate-callback
- Wave 1 CDC suite (also in quality job)

## Artifacts

| Artifact | Contents |
|---|---|
| `m01-envelope-int-d270a4fc51ca317062d14127a53bba419e87b341` | `summary.json`, `ARTIFACT-INDEX.json`, per-task JUnit/logs/meta, OPA results, contracts snapshot |
| `unit-results` | unit JUnit + coverage summary |
| `gate-results` | architecture gates |
| `e2e-results` | Playwright e2e |

## Provenance

Do not accept `hostname=cursor` captures under `evidence/SF-M01-00{1..5}/` as final evidence. Use GitHub Actions artifacts bound to SHA `7a571ced96a233f9f233b7af730e4645dccbd1a4` only.
