# M09 G4 gate record (human issuance)

**Issued gate: `G4_SECURITY` + `_` + `VERIFIED` (M09 module-exit / security verified)**

Human gate authority **Debabrata Nayak** issued this gate (`complete G4`, 2026-10-16) after EVD recommendation [#177](https://github.com/dbn1972/serviceform-ai/pull/177) and residual remediations [#180](https://github.com/dbn1972/serviceform-ai/pull/180) + [#181](https://github.com/dbn1972/serviceform-ai/pull/181). This pull request **records** issuance only. The recording agent does **not** self-certify (`recording_agent_self_issued=false`). **Not CERTIFIED. Not RELEASE CERTIFIED. Not G6.** M10 remains **POLICY_INPUT_REQUIRED**.

| Field | Value |
|---|---|
| Module | M09 (CMP-056..061; INT-014..019 + INT-011/013) |
| Human decision | **`G4_SECURITY` + `_` + `VERIFIED`** |
| Decision authority | Human gate authority / Debabrata Nayak |
| Authorization | `HUMAN_M09_G4_AUTHORIZATION` |
| Independent EVD review | `ACCEPTED` (recommendation [#177](https://github.com/dbn1972/serviceform-ai/pull/177) superseded by this issuance) |
| `gate_issued` / `gate_ready` / `gate_passed` / `human_gate_issued` | **true** |
| Lifecycle | `HUMAN_GATE_ISSUED` |
| Production tip at record | `origin/main` `64d37721` + `f6bfa24c9356ef7464a3ecc68e24b155` (merge [#181](https://github.com/dbn1972/serviceform-ai/pull/181)) |
| EVD recommendation SoT | `52de0098` + `5cf5f895a3fbd65f53b32e8af0713d73` (merge [#177](https://github.com/dbn1972/serviceform-ai/pull/177)) |
| Self-certified | **false** (`recording_agent_self_issued: false`) |
| CERTIFIED / G6 / RELEASE CERTIFIED | **false** |
| Production code modified by this PR | **false** (gate-record / handover only) |
| Critical findings at issuance tip | **0** (F-01..F-08 cleared on tip) |
| M10 / G6 | **POLICY_INPUT_REQUIRED** / **not issued** |

## Bound verifier / evidence results

| Gate | Source | Result | Merged |
|---|---|---|---|
| SEC (initial FAIL) | [#172](https://github.com/dbn1972/serviceform-ai/pull/172) | criticals found | **true** |
| INT (initial FAIL) | [#173](https://github.com/dbn1972/serviceform-ai/pull/173) | criticals found | **true** |
| EVD HOLD | [#174](https://github.com/dbn1972/serviceform-ai/pull/174) | G4 not recommended | **true** (superseded) |
| CMP-059 / CMP-060 rem | [#175](https://github.com/dbn1972/serviceform-ai/pull/175) / [#176](https://github.com/dbn1972/serviceform-ai/pull/176) | criticals cleared | **true** |
| INT / SEC re-verify | [#178](https://github.com/dbn1972/serviceform-ai/pull/178) / [#179](https://github.com/dbn1972/serviceform-ai/pull/179) | `PASS_WITH_FINDINGS`, criticals 0 | **true** |
| EVD G4 recommend | [#177](https://github.com/dbn1972/serviceform-ai/pull/177) | `SF_M09_EVD_PASS_G4_RECOMMENDED` | **true** (superseded by this issuance) |
| Residual F-02/03/05/06 | [#180](https://github.com/dbn1972/serviceform-ai/pull/180) | cleared | **true** |
| Residual F-01/07/08 | [#181](https://github.com/dbn1972/serviceform-ai/pull/181) | cleared; INT 58/58 local | **true** |

## Tip-verify (issuance base)

| Workflow | Head | Conclusion |
|---|---|---|
| ci | `64d37721…` | [38874634491](https://github.com/dbn1972/serviceform-ai/actions/runs/38874634491) **SUCCESS** |
| security | `64d37721…` | [38874634541](https://github.com/dbn1972/serviceform-ai/actions/runs/38874634541) **SUCCESS** |
| developer-platform | `64d37721…` | [38874634462](https://github.com/dbn1972/serviceform-ai/actions/runs/38874634462) **SUCCESS** |

## Non-claims

| Claim | Value |
|---|---|
| CERTIFIED | **false** |
| G6 / RELEASE_CERTIFIED | **false** |
| self_certified / recording_agent_self_issued | **false** |
| M10 golden release | **false** — owner fields remain `POLICY_INPUT_REQUIRED` |
| Invented residence statute | **none** |

Machine record: `orchestrator/handovers/SF-M09-GATE.yaml`. Supersedes recommendation-only status in `docs/verification/M09-G4-RECOMMENDATION.md`.
