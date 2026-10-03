# ServiceForm AI Autonomous AI Development Package v2.5

This bundle converts the ServiceForm AI architecture into a repository-native instruction package for Cursor, Claude Code and GitHub Copilot.

## Quick start with Cursor
1. Extract this package into the root of a new Git repository.
2. Open that repository folder in Cursor.
3. Commit the package before coding so architecture/rule changes are reviewable.
4. Use Cursor Agent (not only inline edit) so project rules are loaded.
5. Paste the contents of `MASTER_CURSOR_PROMPT.md` into a new Agent conversation.
6. Let Cursor execute only `prompts/00_ARCHITECTURE_VERIFICATION.md` first.
7. Review its audit. Resolve BLOCKER/HIGH findings or approve ADRs.
8. Then run `prompts/01_REPOSITORY_BOOTSTRAP.md`.
9. Continue with `prompts/02_BUILD_NEXT_MODULE.md` one module at a time.
10. Do not ask Cursor to build all 61 components in one pass.

Cursor reads root `AGENTS.md`, root `CLAUDE.md`, and `.cursor/rules/*.mdc`. Keep these version-controlled and concise. The DOCX specifications remain the detailed human/source documents while repository rules provide focused working context.

## Claude Code
Open the same repository with Claude Code. `CLAUDE.md` and `AGENTS.md` point Claude back to the same architecture constitution and build plan. Use the same module-by-module workflow and evidence gates.

## Copilot
The `.github/copilot-instructions.md` file supplies the shared project guidance. Use repository issues/PRs tied to CMP/INT IDs and require the same CI gates before merge.


## v2.5 baseline
Adds CMP-056..CMP-061, INT-014..INT-019, BPMN interoperability, signed `.sfpackage`, active-case workflow migration, semantic registry, assisted service, risk/integrity, privacy rights and AI model/prompt/evaluation governance.


## UX baseline
UX4G Design System 3.0 is mandatory. Start UI foundation work with `prompts/06_UX4G_DESIGN_SYSTEM_FOUNDATION.md` and read `DESIGN-SYSTEM.md`.


## Multi-agent development
For parallel Cursor/Claude/Copilot work, run `prompts/07_MULTI_AGENT_ORCHESTRATOR.md` first. The orchestrator creates bounded tasks, branches/worktrees, path ownership and contract locks. Start workers with `prompts/08_MULTI_AGENT_WORKER.md`; validate seams with `prompts/09_INTEGRATION_STITCHING_AGENT.md`; validate evidence with `prompts/10_VERIFICATION_AGENT.md`. Read `MULTI-AGENT-DEVELOPMENT.md`.
## Claude Code multi-agent guide
Use `CLAUDE-MULTI-AGENT-GUIDE.md` as the single execution playbook for Claude Code team leads, teammates and worktree-based fallback sessions.



## Claude model routing & quality
Read `MODEL-ROUTING-QUALITY.md` and `specs/model-routing-quality.yaml`. Default orchestration/critical verification uses Opus 5.5; bounded implementation uses Sonnet 5.5 where specified. The quality KPI is >=90% verified first-pass acceptance, while blocking tenant/security/financial/credential/contract gates require 100% compliance. Run `prompts/12_MODEL_ROUTING_QUALITY_GATE.md` before recommending a task gate.
