# M01 Wave 1 post-merge closure

**Decision: `M01_WAVE1_MERGED_AND_CLOSED`**

PR #22 is merged to `main`. Independent verification V1–V5 remain **PASS**. Lifecycle is **MERGED / GATE_PASSED**. **Not CERTIFIED.** Wave 2 **not** started.

| Field | Value |
|---|---|
| Module | M01 Wave 1 |
| Merge PR | https://github.com/dbn1972/serviceform-ai/pull/22 |
| Merge commit (`origin/main`) | `37cbf203e18d8e072353139e368356a8dac00946` |
| Verified candidate SHA | `7a571ced96a233f9f233b7af730e4645dccbd1a4` (ancestor of main) |
| Gate-record SHA | `4aad559abd6c1726d56e49bae7e79c2bf4be97ca` (ancestor of main) |
| Historical failed baseline | PR #21 tip `d33601a5c2c332548530897df1bd35702317df44` (immutable ancestry; not rewritten) |
| Successful Wave 1 baseline | PR #22 remediation/gate evidence on candidate `7a571ce` |
| Overall | **`M01_WAVE1_MERGED_AND_CLOSED`** |
| Self-certified | **false** |
| CERTIFIED | **false** (`not_certified: true`) |
| Wave 2 started | **false** |

## Ancestry confirmation

| Commit | Role | Ancestor of `origin/main` @ `37cbf20` |
|---|---|---|
| `7a571ced96a233f9f233b7af730e4645dccbd1a4` | Verified candidate | YES |
| `4aad559abd6c1726d56e49bae7e79c2bf4be97ca` | Gate record | YES |
| `d33601a5c2c332548530897df1bd35702317df44` | PR #21 historical failed baseline | YES (preserved; document-only) |

## Verifier results (from gate record; not re-invented)

| Gate | Result |
|---|---|
| V1 Integration | `V1_INTEGRATION_PASS` |
| V2 Security | `V2_SECURITY_PASS` (`CROSS_TENANT_LEAKAGE=0`) |
| V3 Architecture | `V3_ARCHITECTURE_PASS` (frozen contracts **13/13 MATCH**) |
| V4 Quality | `V4_QUALITY_PASS` |
| V5 Evidence | `V5_EVIDENCE_PASS` (documented suite-meta merge-ref limitation) |

Sources: `docs/verification/M01-WAVE1-INDEPENDENT-VERIFICATION.md`, `orchestrator/handovers/M01-WAVE1-GATE.yaml`, store mirror `docs/m01-wave1-independent-verification.md`.

## GitHub runs

### Pre-merge verified candidate (`7a571ce`)

| Workflow | Run ID | Conclusion |
|---|---|---|
| ci | [37163807120](https://github.com/dbn1972/serviceform-ai/actions/runs/37163807120) | SUCCESS |
| security | [37163807119](https://github.com/dbn1972/serviceform-ai/actions/runs/37163807119) | SUCCESS |

### Post-merge `main` HEAD (`37cbf20`)

| Workflow | Run ID | Conclusion |
|---|---|---|
| ci | [37165664149](https://github.com/dbn1972/serviceform-ai/actions/runs/37165664149) | SUCCESS |
| security | [37165664207](https://github.com/dbn1972/serviceform-ai/actions/runs/37165664207) | SUCCESS |

Dependabot/dynamic update runs on the same SHA are unrelated noise; primary gates are `ci` + `security`.

## PR disposition

| PR | Disposition | Notes |
|---|---|---|
| #22 | **MERGED** | Successful M01 Wave 1 remediation/gate baseline |
| #21 | **MERGED** (historical) | Tip `d33601a` preserved as failed-verification baseline under ancestry; not rewritten; not the successful gate baseline |
| #14 | **MERGED** | Contained in main via Wave 1 stitch/remediation lineage under #22 |
| #15 | **MERGED** | Contained in main via Wave 1 stitch/remediation lineage under #22 |
| #16 | **MERGED** | Contained in main via Wave 1 stitch/remediation lineage under #22 |
| #17 | **MERGED** | Contained in main via Wave 1 stitch/remediation lineage under #22 |
| #18 | **MERGED** | Contained in main via Wave 1 stitch/remediation lineage under #22 |
| #19 | **CLOSED** (superseded) | Lockfile/manifests already on main via regen `c32d5361` (ancestor of merge); closed without separate merge |

`gh` issue-comment / `closePullRequest` returned 403 for this agent integration; supersession/containment is recorded here. PR #19 was closed via ManagePullRequest `set_pr_status`.

## Handover lifecycle

`orchestrator/handovers/SF-M01-001.yaml` … `SF-M01-005.yaml` and `orchestrator/handovers/M01-WAVE1-GATE.yaml` updated to:

- `state` / lifecycle: **MERGED** / **GATE_PASSED** (`MERGED_GATE_PASSED`)
- `self_certified: false`
- `not_certified: true` (and `certified: false` where that field exists)
- `wave2_started` / `wave_2_started: false`
- merge commit + verified candidate + gate-record SHAs bound

## Residuals (non-blocking; unchanged)

1. **ADR-0006 #9 / SF-CON-OUTBOX:** `GRANT INSERT` (and inbox `SELECT, INSERT`) **TO `sf_app`** remains frozen-template behavior; CCR required to tighten.
2. **Not CERTIFIED** — merge/gate-pass is not module/release certification.
3. **No Wave 2** — host composition (`apps/api` / CMP-036) remains out of scope.
4. V5 documented suite-meta merge-ref stamp limitation remains accepted as documented.

## Constraints observed

- No Wave 2 started
- No feature / production-code / frozen-contract changes in this closure
- No CERTIFIED claim; `self_certified: false`
- PR #21 baseline not rewritten
- Obsolete component/lockfile PRs not merged separately as part of closure

## Store mirror

`/cursor/stores/bc-1e78e82c-97d0-4244-ab49-3bcc7891e193/docs/m01-wave1-closure.md`
