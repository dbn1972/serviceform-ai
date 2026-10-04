# M01 G4 residual register and dispositions

**Decision token (split against CKV_SECRET_6):** family `SF-M01-G4-004` + status `READY` (join with `_`).  
**Not CERTIFIED.** Residual disposition is documentation only. Does not issue exit record token `M01`/`COMPLETE`/`G4_SECURITY`/`VERIFIED`. Does not authorize CG-01 (M02 ∥ M03).

| Field | Value |
|---|---|
| Task | SF-M01-G4-004 |
| Role | architecture / evidence disposition (no production code) |
| Implementation baseline (envelope) | `c42c7c89aa75653d099883e7f28ece73cf2c7515` |
| Docs baseline (`origin/main` tip at start) | `ab8359f0ffe96834bdf61318d1db7877433e7dcc` |
| Frozen contracts | **13/13 MATCH** — unchanged by this work |
| Self-certified | **false** |
| CERTIFIED / RELEASE CERTIFIED | **false** |
| M02 / M03 / CG-01 | **blocked** until human/CI issues G4 exit token |

Companion evidence: `evidence/SF-M01-G4-004/`.  
Envelope: `orchestrator/handovers/SF-M01-G4-004.yaml`.

## Disposition legend

| Status | Meaning |
|---|---|
| **CLOSED** | Residual resolved with bound evidence on `main`; no further G4 action |
| **CLOSED_IN_CODE** | Fix landed on an open PR tip with evidence; **pending merge to `main`** before exit-token checklist may treat it as closed |
| **OPEN_DEPENDS** | Explicitly open; owned by another G4 envelope; may not be claimed closed here |
| **ACCEPTED_RESIDUAL** | Formally accepted for M01 G4 exit with explicit language; not silently dropped |
| **CARRIED** | Deferred beyond M01 G4 with explicit owner/follow-up; not silent drop |
| **OPS_CONFIRM** | Documented; human/ops must confirm GitHub settings before CG-01 |
| **ACCEPTED_RESIDUAL** (OPS) | Formally accepted as ops residual for a named gate (e.g. exit token); not CLOSED_OPS |

No residual may be omitted. Silent frozen-contract edits are forbidden.

---

## Residual table (authoritative)

| ID | Residual | Source | Disposition | Status | Blocks G4 exit token? | Owner / next |
|---|---|---|---|---|---|---|
| R-ENV-INT | GitHub job previously W1-only (`SF-M01-001..005`) | `evidence/SF-M01-W2-STITCH/RESIDUALS.md`; V5; G4 plan Scope 1; SF-M01-G4-001 + `READY` | **CLOSED_IN_CODE (pending merge).** Fix on PR [#39](https://github.com/dbn1972/serviceform-ai/pull/39) branch `cursor/m01-g4-r-env-int-1573` @ `6d3e495987bd7308596cbbd69ab65c46e242c7bf`. Job renamed to `M01 envelope integration (W1+W2 all CMPs)`; script covers all 11 M01 CMPs; fail-closed; evidence `evidence/SF-M01-G4-001/`. **Not merged to `main` yet** — exit-token checklist treats closed only after merge + tip re-bind. Not CERTIFIED. | **CLOSED_IN_CODE** | **Yes until #39 merges to `main`** | SF-M01-G4-001 → human merge |
| R-OUTBOX-SF-APP | ADR-0006 condition **#9** / SF-CON-OUTBOX: frozen template grants `INSERT` (tenant outbox) and inbox `SELECT, INSERT` **TO `sf_app`**; publisher policies include frozen `USING true` read path for `sf_outbox_publisher` | ADR-0006; W1 closure; W2 V2 residual; `contracts/shared/sql/outbox.template.sql` | **Accepted residual for M01 G4 exit.** Outbox/inbox grants remain exactly as frozen. **No CCR filed in this task.** Tightening later requires an explicit CCR — **never** a silent edit to `contracts/**` or the outbox template. Tenant RLS on tenant outbox still holds; not counted as `CROSS_TENANT_LEAKAGE`. | **ACCEPTED_RESIDUAL** | **No** (accepted) | Optional future CCR (human/contract guardian); not G4-004 |
| R-PROVENANCE | V5 suite-meta / `summary.json` may stamp ephemeral GitHub `pull_request` merge-ref SHAs while workflow `headSha` / `ARTIFACT-INDEX.json` bind the candidate tip | W1 V5 limitation; W2 V5 tip policy | **Formalized rule (below).** Exit evidence MUST bind authoritative `headSha` / `ARTIFACT-INDEX.json` `commit_sha`. Suite-meta merge-ref stamps are informational only and must not be used as the sole bind. | **CLOSED** (rule formalized) | **No** | G4-002/003/005 evidence writers must follow rule |
| R-BRANCH-PROT | Branch protection / required status checks on `main` before M02/M03 dispatch | G4 plan Scope 4; CG-01 gate; human Debabrata Nayak token auth | **ACCEPTED_RESIDUAL (OPS) for M01 G4 exit token.** Probe `2026-10-04T05:58Z`: `GET branches/main` → `protected:false`; rulesets `[]`; protection GET 403. Human authorized exit token with this residual; **CLOSED_OPS not required for token**. Enabling protection remains optional ops hygiene before CG-01 start (separate auth). Supersedes PR #42 blocked-enable docs. | **ACCEPTED_RESIDUAL** | **No for exit token** (accepted); CG-01 start still needs separate human authorization | Human authorized for token; optional ops enable before CG-01 |
| R-COV | Global unit coverage excludes W2 int-only surfaces (CMP-003/030/032 routes/repos/db; CMP-055 CLI) | W2 stitch `RESIDUALS.md`; V4 | **Carried.** Component coverage + `*.int.test.ts` + independent INT remain authoritative. Do not weaken global thresholds to force inclusion. | **CARRIED** | **No** | Quality / later coverage hygiene |
| R-INFRA | REAL S3 / KMS / WAF connectors | W2 stitch; V2 | **Carried** as deferred ADR/infra. CMP-032 remains SIMULATED/local for M01. No SIMULATED critical connector in production (separate production gate). | **CARRIED** | **No** | Future ADR / infra when production connectors required |
| R-DPDP | Statutory DPDP / privacy content anchors | W2 plan Arch Verif M-09 | **Carried.** CMP-030 is platform consent/purpose machinery only. Stop + ADR if statutory interpretation would be required. No policy invention in exit docs. | **CARRIED** | **No** | ADR if/when statutory anchors demanded |
| R-CMP055-PKG | `services/cmp-055-developer-platform/**` has no `package.json` on main | G4 plan blockers; G4-001 path vitest | **Carried** (packaging). G4-001 mitigates envelope-int via **path-based vitest** (no new `package.json` / no product features). Still no workspace package filter on main until a future packaging-only change. | **CARRIED** | **No** for exit if path vitest remains in envelope-int after #39 merge | Optional packaging follow-up |
| R-MIG-TS | Shared migration timestamp prefix `1759500600000` for cmp-003 and cmp-032 | W2 stitch | **Closed as non-defect.** Distinct filenames; `migration_lint` PASS; lexicographic order stable. | **CLOSED** | **No** | — |
| R-RUNTIME | Default `apps/api` entry does not auto-wire pool/OPA; optional `wave1` / `wave2` mounts | W2 stitch | **Carried** as Phase A/B host design. Not an exit security defect; composition suites cover mounts when enabled. | **CARRIED** | **No** | Host/runtime follow-up outside M01 feature freeze |
| R-BUILDER-JUNIT | Builder Cursor-host junit artifacts (`hostname=cursor`) | W2 V5 | **Carried** as supporting-only. Gate proof relies on independent INT/SEC + GitHub tip CI, not builder self-junit alone. | **CARRIED** | **No** | Evidence role (already practiced) |
| R-LOCKFILE-W2 | Builder PRs #26/#27/#28/#29 outdated lockfile | W2-001/002 CI residuals | **Closed** on stitch/main via canonical `pnpm-lock.yaml` regen (W2 stitch). | **CLOSED** | **No** | — |
| R-W2-VERIFY-DISPATCH | R-INT / R-SEC / R-EVD “expected” at stitch time | W2 stitch residuals | **Closed** via independent INT #31, SEC #32, EVD V5 PASS / gate-combine #33. | **CLOSED** | **No** | — |
| R-NOT-CERTIFIED | Module/release not CERTIFIED | Constitution / all gates | **Accepted standing constraint.** G4 exit token ≠ RELEASE CERTIFIED / G6. `certified: false` remains mandatory on exit record. | **ACCEPTED_RESIDUAL** | N/A (standing) | Human/CI certification gates only |
| R-HYGIENE-RATELIMIT | Dual `@fastify/rate-limit` majors (W1 quality hygiene) | W1 independent verification | **Carried** non-blocking hygiene. | **CARRIED** | **No** | Dependency hygiene backlog |

---

## Required dispositions (detail)

### 1. R-ENV-INT — CLOSED_IN_CODE (pending merge of SF-M01-G4-001)

| Claim | Value |
|---|---|
| Status | **CLOSED_IN_CODE** — not yet CLOSED on `main` |
| Owner | **SF-M01-G4-001** |
| PR / branch / SHA | [#39](https://github.com/dbn1972/serviceform-ai/pull/39) / `cursor/m01-g4-r-env-int-1573` / `6d3e495987bd7308596cbbd69ab65c46e242c7bf` |
| Token observed | family `SF-M01-G4-001` + status `READY` (builder; not CERTIFIED) |
| Evidence | `evidence/SF-M01-G4-001/` (job rename, script generalize, coverage matrix, path-smoke) |
| Close-on-main criteria | #39 merged; `origin/main` tip includes generalized job; GitHub `m01-envelope-int` SUCCESS with ARTIFACT-INDEX bound to that tip |
| G4-005 impact | Checklist “R-ENV-INT closed” may flip only after merge + tip bind — **not** while status is CLOSED_IN_CODE alone |

### 2. ADR-0006 #9 / SF-CON-OUTBOX `sf_app` grants — accepted residual (no CCR)

**Exit-record language (normative for G4-005):**

> M01 G4 exit **accepts** ADR-0006 condition 9 residual: SF-CON-OUTBOX remains frozen with `sf_app` INSERT (and inbox SELECT/INSERT) grants as copied from `contracts/shared/sql/outbox.template.sql`. No Contract Change Request is opened by SF-M01-G4-004. Any future tightening of outbox/inbox grants or publisher policies requires an explicit CCR; silent mutation of frozen contracts is prohibited.

Observed frozen grants (illustrative; do not edit):

- `GRANT INSERT ON {schema}.outbox_event TO sf_app;`
- `GRANT INSERT ON {schema}.outbox_event_platform TO sf_app;`
- `GRANT SELECT, INSERT ON {schema}.inbox_event TO sf_app;`
- `GRANT SELECT, INSERT ON {schema}.inbox_event_platform TO sf_app;`

`contracts_lock_gate.py` remains **13/13 MATCH**. This disposition does **not** change hashes.

### 3. V5 / evidence provenance rule (formalized)

| Artifact class | Authority for exit bind |
|---|---|
| GitHub Actions workflow run `headSha` | **Authoritative** candidate commit |
| `ARTIFACT-INDEX.json` `commit_sha` (envelope-int / exit suites) | **Authoritative** when equal to workflow `headSha` of the bound run |
| Suite-level `*.meta.json` / `summary.json` `commit_sha` | **Informational only** when it equals an ephemeral `pull_request` merge ref; must be disclosed if present |
| Merge commit of a PR into `main` | Use for post-merge main tip binds; do not confuse with pre-merge PR head |
| Builder self-claims / Cursor-host junit | Supporting only — never sole VERIFIED proof |

**Rule for G4 exit evidence (G4-001…005):** every exit artifact index MUST record `commit_sha` = the exact tip under test (PR head on PRs; `origin/main` tip for post-merge). If suite meta differs (merge-ref), document the pair explicitly; do not treat the merge-ref as the gate SHA.

### 4. Branch protection / required checks — before M02/M03

**Required checks (human must ensure on `main` before CG-01):**

| Workflow | Job examples (names may evolve with G4-001) | Must be required? |
|---|---|---|
| `ci` | format/lint/unit/contracts/build; architecture gates; migrations/tenant-isolation; **M01 envelope integration (W1+W2 all CMPs)** (name on PR #39; require this after merge); web shells; flutter; workflow validation | **Yes** |
| `security` | gitleaks; semgrep; CodeQL; dependency audit; checkov | **Yes** |

**Observed probes (2026-10-04):**

| Probe | Result |
|---|---|
| `GET /repos/dbn1972/serviceform-ai/branches/main` | **200** — `protected: false` (re-confirmed at token issuance `05:58Z`) |
| `GET /repos/dbn1972/serviceform-ai/branches/main/protection` | **403** Resource not accessible by integration |
| `GET /repos/dbn1972/serviceform-ai/rulesets` | **[]** empty (no rulesets visible to token) |
| Repo permissions for integration | admin/maintain/push **false** |

**Disposition (updated at token issuance):** **ACCEPTED_RESIDUAL** (OPS class; not CLOSED_OPS). Human Debabrata Nayak authorized the M01 G4 exit token with R-BRANCH-PROT accepted as an OPS residual while `main` remains unprotected from the Cursor API view. Do not invent branch-protection configuration in-repo. Enabling required checks remains optional ops hygiene before **starting** CG-01 (separate authorization). PR #42 (blocked enable attempt) is superseded by this disposition.

---

## Acceptance checklist (SF-M01-G4-004)

| Check | Result |
|---|---|
| Every known M01 residual closed or formally carried with explicit language | **PASS** (table above) |
| R-ENV-INT disposition tracks G4-001 without false main-closed claim | **PASS** — **CLOSED_IN_CODE** pending #39 merge |
| ADR-0006 #9 accept-or-CCR resolved without silent contract edit | **PASS** — **ACCEPTED_RESIDUAL**, no CCR, contracts untouched |
| Provenance rule formalized | **PASS** |
| Branch protection / required checks noted before M02/M03 | **PASS** — later **ACCEPTED_RESIDUAL** for exit token (human) |
| Frozen contracts 13/13 unchanged | **PASS** |
| CERTIFIED claimed | **false** |
| Write paths limited to envelope allow-list | **PASS** |

## Explicit non-claims

- Not `M01`/`COMPLETE`/`G4_SECURITY`/`VERIFIED`
- Not RELEASE CERTIFIED / G6
- R-ENV-INT **not** claimed CLOSED on `main` (only CLOSED_IN_CODE pending #39)
- No frozen-contract or outbox-template mutation
- No M02 / M03 / CG-01 dispatch
- No Wave 3 feature work

## Changelog

| When | Change |
|---|---|
| Initial | R-ENV-INT = OPEN_DEPENDS on SF-M01-G4-001 |
| After SF-M01-G4-001 + `READY` | R-ENV-INT → **CLOSED_IN_CODE** bound to PR #39 @ `6d3e495`; still not CERTIFIED |
| `2026-10-04T05:58Z` token issuance | Human issued exit token; R-BRANCH-PROT → **ACCEPTED_RESIDUAL** (OPS; `protected:false`; CLOSED_OPS not required) |
| Token PR #43 | Supersedes #42 blocked-enable attempt; residual disposition recorded with issuance |

## Sources consulted

- `docs/planning/M01-G4-EXIT-PLAN.md`, `orchestrator/handovers/SF-M01-G4-004.yaml`
- `evidence/SF-M01-G4-001/EVIDENCE.md` (PR #39 tip `6d3e495`)
- `evidence/SF-M01-W2-STITCH/RESIDUALS.md`, W1/W2 verification docs
- `docs/adr/ADR-0006-per-component-write-roles.md`
- `contracts/shared/sql/outbox.template.sql` (read-only)
- `orchestrator/contracts-lock.yaml` + `scripts/gates/contracts_lock_gate.py` (13/13 MATCH @ `ab8359f`)
