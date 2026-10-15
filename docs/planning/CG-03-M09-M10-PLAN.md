# CG-03 plan: M09 ∥ M10 after M07+M08 G3 exits (PLANNING ONLY)

**Decision token (split against CKV_SECRET_6):** family `CG03_M09_M10_PLANNING` + status `PLANNING` (do **not** join).  
**Envelope state:** `PLANNING`. **Not READY.** **Not dispatched.** Not CERTIFIED. Not RELEASE CERTIFIED. Not G6. **Implementation OFF.** **Builders OFF.** **M11–M12 OFF.**

| Field | Value |
|---|---|
| Concurrency group | CG-03 (`specs/build-plan.yaml`, `specs/agent-orchestration.yaml`) |
| After | M07 exit `G3_INTEGRATION_VERIFIED` + M08 exit `G3_INTEGRATION_VERIFIED` on main |
| Parallel modules | **M09** Interoperability / Omnichannel / Integrity / Trust **∥** **M10** Golden Residence Certificate |
| Planning baseline | prefix `6420d44f` + suffix `d6f7555ab27594743fafccabbf043359` |
| M07 G3 | issued (#156) tip includes gate record |
| M08 G3 | issued (prior tip) |
| Frozen contracts | **34/34 MATCH** — existing rows immutable |
| `CG_03_CONTRACT_FREEZE_REQUIRED` | **true** (NEW M09 contracts; M10 is mostly metadata/templates — freeze only if NEW schemas proposed) |
| `STATUTORY_OWNER_INPUT_REQUIRED` (M10) | **true** — Finding M-04; do not invent pilot/legal/eligibility/fee/SLA/credential statute |
| CERTIFIED / RELEASE CERTIFIED / G6 | **false** |
| `planning_only` | **true** |
| `implementation_authorized` | **false** |
| Builders dispatched | **0** |
| M11 / M12 | **OFF** until M10 G6 |

Human authorization: `HUMAN_CG03_AUTHORIZATION` / `HUMAN_CG03_THROUGH_EVD_AUTHORIZATION` (planning slice). This PR does **not** freeze contracts and does **not** spawn builders.

Machine index: `orchestrator/handovers/CG-03-PLAN.yaml`. Module indexes: `M09-PLAN.yaml`, `M10-PLAN.yaml`. Envelopes: `docs/planning/CG-03-M09-M10-ENVELOPES.md`. Contracts: `docs/planning/CG-03-M09-M10-CONTRACT-PREREQUISITES.md`.

## Governance sequence

1. Architecture Constitution + frozen **34/34** contracts (MATCH)
2. M07 G3 + M08 G3 issued on tip `6420d44f…`
3. **This pass (LOCK-1):** CG-03 envelopes PLANNING; no freeze; no READY; no builders
4. LOCK-2: SF-M09-CG-001 NEW `contracts/m09/**` freeze (append-only; existing 34 immutable). M10 freeze only if NEW golden-template schemas require lock rows.
5. LOCK-3: Wave A parallel builders (M09 CMPs; M10 template/studio packages) after freeze on `origin/main` + READY + dispatch
6. LOCK-4: STITCH-A per module
7. LOCK-5: Wave B / sequenced (M09 cross-cutting BPMN/sfpackage/migration/AI-gov packaging; M10 E2E harness)
8. LOCK-6: STITCH-B
9. LOCK-7: Host mounts — **hard serial**: SF-M09-HOST never concurrent with SF-M10-HOST (`apps/api/**` single-writer)
10. LOCK-8: INT ∥ SEC (M09: INT-014..019 + INT-011/013; M10: Golden E2E + tenant isolation + G5 perf evidence + UX4G)
11. LOCK-9: EVD recommend only → human may issue **M09 G4** / **M10 G6** under separate authorizations

## Topology

```text
[M07 G3 + M08 G3 on main 6420d44f…]
            |
[THIS PASS: CG-03 PLANNING; builders OFF; no freeze]
            |
   +--------+--------+
   |                 |
 M09                 M10
 CMP-056..061        Golden IND-SOC-002 template
 INT-014..019        + TSB + E2E/G5/UX4G evidence
 cross-cutting       owner POLICY_INPUT_REQUIRED
   |                 |
 CG-001 freeze       (schemas if needed)
   |                 |
 Wave A builders     Wave A template/studio
   |                 |
 STITCH → HOST       STITCH → HOST (serial vs M09)
   |                 |
 INT∥SEC → EVD       INT∥SEC/PERF → EVD
 recommend G4        recommend G6 (not self-issue)
```

## Non-claims

CERTIFIED=false · G4(M09)=false until human · G6=false · self_certified=false · no invented residence eligibility/fee/SLA statute · risk signals non-authoritative · assisted `applied_by`≠`applied_for` · Privacy Centre no cross-component SQL · BPMN≠Temporal replacement · `.sfpackage` no secrets.
