# Claude Code Instructions - ServiceForm AI

Read and obey `AGENTS.md` and `ARCHITECTURE-CONSTITUTION.md` before modifying code.

Work one bounded build-plan item at a time. Use approved CMP/INT contracts. Do not infer government policy. Do not change architecture silently. Write/update tests and contracts with implementation. Run deterministic checks after edits. Never mark work VERIFIED/CERTIFIED without executed evidence and a human/CI gate.

When a task conflicts with architecture or requires a new database, infrastructure service, cross-tenant behavior, statutory interpretation, security weakening, or breaking contract: stop, document the issue and propose an ADR.


## UX4G UI rule
Before modifying UI, load `DESIGN-SYSTEM.md` and `specs/design-system.yaml`. UX4G 3.0 is mandatory. Do not invent CSS/components where UX4G or a ServiceForm UX4G extension exists. UI verification requires executed accessibility/keyboard/responsive/visual-regression evidence.


## Multi-agent mode
If this Claude session is one of several concurrent agents, read the assigned orchestrator task envelope plus `MULTI-AGENT-DEVELOPMENT.md` and `specs/agent-orchestration.yaml`. Never write outside allowed paths or change FROZEN contracts without a change request.
## Mandatory multi-agent operating guide
Before planning or running concurrent development, read `CLAUDE-MULTI-AGENT-GUIDE.md`. It defines the authoritative Read -> Plan -> Dispatch -> Build -> Integrate -> Verify -> Gate procedure for Claude Code.



## Model routing and quality
Read `MODEL-ROUTING-QUALITY.md` and `specs/model-routing-quality.yaml` before dispatching or verifying AI work. The >=90% target is verified first-pass task acceptance, not model self-confidence. Hard tenant/security/financial/credential/contract gates are 100% blocking gates. Use `prompts/12_MODEL_ROUTING_QUALITY_GATE.md` for evidence-based routing and escalation.
