# ADR-0001: Canonical executable build sequence

| Field | Value |
|---|---|
| Status | **PROPOSED** (needs human approver acceptance; until then `specs/build-plan.yaml` stays in force and no M01 task may be dispatched) |
| Date | 3 October 2026 |
| Proposed by | Principal Engineering Orchestrator (Claude), from ARCHITECTURE-VERIFICATION-001 findings H-01 to H-04 |
| Decision owner | Authorized human approver (Architecture & Contract Guardian review recommended) |
| Changes | Scheduling only. No Architecture Constitution rule, frozen decision, component boundary, contract or gate definition changes. |
| Artifact | `specs/build-plan.proposed.yaml` (new file; replaces `specs/build-plan.yaml` only on acceptance) |

## Context

ServiceForm AI currently has four sequencing sources that reuse the same module IDs for different contents:

| Source | Precedence (guide §4) | Sequence |
|---|---|---|
| AWS v1.7 §17 "Frozen Development Sequence" | 2 | M0–M15, one capability per milestone (M5 Rules, M7 Application, M9 Payment, M10 Credential, M14 AI). States it is frozen "unless an accepted ADR changes the sequence". |
| Engineering v1.4 §7 Implementation Wave Plan | 3 | Waves 0–8 (Wave 0 = CMP-055/047/048/031; Wave 6 = 012/025/026/037/038). |
| Engineering v1.4 §12 module certification | 3 | M01–M09 with different contents (§12 M01 = catalogue/metadata/versioning; §12 M06 = evidence + integration backbone). |
| Engineering v1.4 §20.7 and `specs/build-plan.yaml` | 3 / 6 | M00–M11 (M01 = tenancy/security; M06 = payments/notifications). |

`specs/build-plan.yaml` also leaves CMP-027 and CMP-032 unowned, places CMP-052 in two modules and INT-013 in two modules, schedules the event bus, integration hub, API gateway and observability (CMP-038/037/036/047) after modules whose integration contracts need them, schedules four AI components before the AI Gateway, and makes the Golden Residence Certificate wait on AI assistants and the M09 extensions. A dependency check gives 13 hard component violations and 9 hard integration violations (rules below).

Agents resolve conflicts by precedence. Here precedence does not produce one answer, because the two higher-precedence documents disagree with each other and Engineering v1.4 disagrees with itself. Without one canonical sequence the orchestrator cannot build a dependency-correct work queue, so M01 cannot be dispatched safely.

## Decision (proposed)

1. `specs/build-plan.proposed.yaml` becomes the single executable build sequence, renamed to `specs/build-plan.yaml` on acceptance. AWS v1.7 §17 milestones and Engineering v1.4 §7 waves and §12 module groupings remain valid as descriptions of capability and certification content, but are not used for scheduling. AWS v1.7 §17 explicitly permits this change by ADR.
2. Module IDs keep the Engineering v1.4 §20.7 meanings where possible (M00–M11), with one new module, M12 AI Assistants and Agents.
3. Dependency rules used by the orchestrator and by CI (`scripts/validate_specs.py`, an M00 deliverable):
   - **Hard:** the platform backbone (CMP-002, 003, 031, 032, 036, 037, 038, 047, 048, 055) is in the consuming module or an ancestor. CMP-039 AI Gateway is in an ancestor of every AI component (`AI-GOVERNANCE.md`: all model calls pass through the gateway). Every CMP has exactly one owning module and every INT exactly one owner.
   - **Peer, allowed:** edges to external connector components (CMP-012, 021, 025, 026) are satisfied by a FROZEN adapter contract plus SIMULATED adapter (Eng v1.4 §10, which requires that provider availability never blocks development). Edges from non-AI to AI components are optional assistance (Eng v1.4 §6.1: core domains must not depend on AI for correctness). Remaining mutual edges are consumed through FROZEN contracts recorded in `orchestrator/contracts-lock.yaml`.
4. INT-011 (tenant isolation chain) and INT-013 (external dependency simulation contract) are cross-cutting: owned by M01, re-verified at every later module exit gate for the layers that module adds.
5. The Golden Residence Certificate (M10) depends on M07 and M08 only. M09 world-class extensions run in parallel with M10. AI assistants and agents (M12) start after M10, which matches AWS v1.7 §7 ("AI assistance … only after deterministic runtime is proven") and Engineering v1.4 §7 (golden slice before Wave 7 is production-ready). The AI Gateway itself is platform and moves to M04 so that document intelligence and recommendation can use it through governed calls.

### Proposed modules

| Module | Name | Depends on | Components | Owned INT | Exit gate |
|---|---|---|---|---|---|
| M00 | Architecture verification and repository bootstrap | none | (none; FROZEN shared envelopes, CI, validator, CODEOWNERS) | | G1 |
| M01 | Foundation, tenancy, jurisdiction, security and platform backbone | M00 | 002, 003, 030, 031, 032, 036, 037, 038, 047, 048, 055 | INT-011, INT-013 (cross-cutting) | G4 |
| M02 | Identity and citizen profile | M01 | 004, 005 | INT-001 | G3 |
| M03 | Catalogue, versioning, TenantServiceBinding, Studio, UX4G foundation | M01 | 001, 033, 034, 050, 051, 052, 053, 054 | INT-002 | G3 |
| M04 | Forms, rules, evidence, upload, document intelligence, AI Gateway | M02, M03 | 008, 009, 011, 013, 014, 039 | | G3 |
| M05 | Application, case, workflow, tasks, verification, deficiency, SLA, grievance, appeal | M04 | 015, 016, 017, 018, 019, 027, 028, 029 | INT-004, 005, 006, 009 | G4 |
| M06 | Fees, payments, notifications, messaging | M05 | 020, 021, 025, 026 | INT-007 | G3 |
| M07 | Credentials, QR, revocation, DigiLocker | M06 | 012, 022, 023, 024 | INT-008 | G3 |
| M08 | Search, discovery, recommendation, analytics, operations, retention | M05 | 006, 007, 035, 045, 046, 049 | INT-003, INT-010 | G3 |
| M09 | World-class interoperability, omnichannel, integrity, trust | M05, M07, M08 | 056, 057, 058, 059, 060, 061 | INT-014 … 019 | G4 |
| M10 | Golden Residence Certificate certification | M07, M08 | (metadata only, IND-SOC-002) | full golden suite | G6 |
| M11 | Reuse proof with second service | M10 | (metadata only) | | |
| M12 | AI assistants and agents | M10 | 010, 040, 041, 042, 043, 044 | INT-012 | G4 |

Concurrency: CG-01 M02 ‖ M03 after M01; CG-02 M06 ‖ M08 after M05; CG-03 M09 ‖ M10 after M07 and M08; CG-04 M11 ‖ M12 after M10.

### What moved and why

| Item | `build-plan.yaml` | Proposed | Reason |
|---|---|---|---|
| CMP-032 Storage | unowned | M01 | Needed by CMP-013 (M04), 022, 049 and INT-006/011; Eng v1.4 §7 Wave 3 at latest |
| CMP-027 Grievance | unowned | M05 | Eng v1.4 §12.5 places it with case execution |
| CMP-052 Versioning Registry | M01 and M03 | M03 | Single owner; it pairs with 033/051 in every source |
| CMP-036/037/038 API Gateway, Integration Hub, Event Bus | M06 | M01 | Outbox (Constitution #11) and INT-001/004/005/010/011 need them; Eng v1.4 §7 Wave 0/6 |
| CMP-047 Observability | M08 | M01 | Backbone depends on it; Eng v1.4 §7 Wave 0 |
| CMP-039 AI Gateway | M08 | M04 | Before any model-calling component |
| CMP-010, 040, 043, 044 (AI design agents) | M04 | M12 | After AI Gateway and after deterministic golden proof |
| CMP-041, 042 (citizen assistant, officer copilot) | M08 | M12 | Same |
| CMP-012 DigiLocker | M07 | M07 (unchanged) | Consumed earlier via SIMULATED adapter |
| INT-006 Evidence and verification | M04 | M05 | Needs workflow, tasks and inspection (016/017/018) |
| INT-011, INT-013 | M05; M02 + M06 | M01, cross-cutting | One owner; re-verified at each gate |
| M10 depends on | M07, M08, M09 | M07, M08 | Golden flow uses no M09 or AI-assistant component |

### Mapping to the authoritative sequences

| AWS v1.7 §17 milestone | Proposed module |
|---|---|
| M0 Repository foundation | M00 |
| M1 Tenant + organisation + jurisdiction | M01 |
| M2 Identity | M02 |
| M3 Service Registry + Template Registry; M4 Form Designer (Studio) | M03 (Studio and registry), M04 (form engine runtime) |
| M5 Rules; M6 Evidence & Document | M04 |
| M7 Application/Case; M8 Workflow & Tasks + Visual Workflow Designer | M05 (runtime); designer canvas in M03 |
| M9 Payment; M11 Notification | M06 |
| M10 Credential/QR; M13 DigiLocker | M07 |
| M12 Search & Recommendation; M15 Analytics/MIS | M08 |
| M14 AI Assistants | M04 (gateway) + M12 (assistants/agents) |
| §17.1 Golden Vertical Slice | M10, then M11 |
| v1.7 §21 extensions (CMP-056…061) | M09 |

Engineering v1.4 §7 waves map as: Wave 0 → M01 (+ M00 contracts), Wave 1 → M01/M02, Wave 2 → M03, Wave 3 → M04 (+ CMP-032 in M01), Wave 4 → M05, Wave 5 → M06/M07, Wave 6 → M01 (037/038) and M06/M07 (012/025/026), Wave 7 → M04 (039), M08, M12, Wave 8 → M05 (027/028) and M08 (045/046/049). Engineering v1.4 §12 module certification criteria are applied per component, wherever the component now sits.

## Verification of the proposal

Re-run of the build-plan dependency check (Engineering v1.4 §4 declared dependencies, Engineering v1.4 §5 INT participants) on 3 October 2026:

| Check | `specs/build-plan.yaml` | `specs/build-plan.proposed.yaml` |
|---|---|---|
| Components placed | 60 placements, 59 unique | 61 placements, 61 unique |
| Unowned components | CMP-027, CMP-032 | none |
| Duplicate components | CMP-052 | none |
| INT with two owners | INT-013 | none |
| Module graph acyclic | yes | yes |
| Hard component-dependency violations | 13 | **0** |
| Hard integration violations | 9 | **0** |
| Peer edges via SIMULATED connector contract | 7 | 8 |
| Peer edges via optional AI assistance | 3 | 2 |
| Peer edges via FROZEN contract only | 19 | 19 |
| Golden (M10) waits on AI assistants or M09 | yes | no |

The 19 FROZEN-contract peer edges are all cases where a provider lists one of its consumers as an integration partner (for example CMP-002 Tenant lists CMP-004 Identity; CMP-032 Storage lists CMP-013 Upload). They require the shared contract to be FROZEN before the consumer starts, which the orchestration rules already enforce.

## Consequences

- M01 grows from 7 to 11 components. It runs as controlled parallel streams (tenancy/jurisdiction; security/audit/consent; storage/gateway/event bus/integration hub; observability/developer platform) per Eng v1.4 §20.7, with backbone slices kept minimal (envelopes, outbox relay, adapter SPI, OTel baseline).
- INT-002 can verify publication of workflow versions in M03 but full compile-and-run of a published workflow is verified when the M05 runtime exists; M03's G3 evidence must state this limitation.
- AI design assistance in Studio (CMP-040/043) arrives in M12. Studio publication in M03 runs deterministic validators only, which is what the architecture requires for correctness anyway.
- `prompts/02`, `prompts/07` and `MULTI-AGENT-DEVELOPMENT.md` refer to modules by number; their wording stays valid except the line "M06 and M08 can run in parallel after M05; M07 follows M06", which remains true, and "M10 is integrated Golden Residence certification", also true. `MULTI-AGENT-DEVELOPMENT.md` would gain M12 in its parallelization list on acceptance.

## Alternatives considered

1. **Adopt AWS v1.7 §17 M0–M15 literally.** Highest precedence, but one capability per milestone serializes tightly coupled components (case/workflow/tasks/SLA, which Eng v1.4 §11.2 says may share a Unit of Work) and puts DigiLocker after credentials although evidence needs it. Rejected.
2. **Adopt Engineering v1.4 §12 M01–M09.** Puts catalogue/versioning before tenancy security and has no golden or reuse module. Rejected.
3. **Keep `build-plan.yaml` and fix only ownership (CMP-027/032/052).** Leaves 11 hard violations (backbone after consumers, AI before gateway). Rejected.

## Approval

Accept by changing Status to ACCEPTED with approver name and date, renaming `specs/build-plan.proposed.yaml` to `specs/build-plan.yaml` (version 2.5-adr0001), and recording the change in `CHANGELOG`/commit. Reject or amend by comment on this file.
