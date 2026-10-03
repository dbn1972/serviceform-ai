# AI Governance

All model calls pass through the AI Gateway.

## Gateway responsibilities
- approved provider/model allowlist and version pinning;
- data classification and redaction;
- tenant/source ACL enforcement for retrieval;
- prompt/template registry and change history;
- tool allowlists and least privilege;
- token/cost/rate controls;
- evaluation threshold and regression suite;
- audit of prompt template ID, model, tool calls, citations and outcome metadata.

## Decision boundary
AI can draft, extract, summarize, explain, recommend non-binding content, generate tests and assist officials. Deterministic approved rules and authorized officials remain authoritative for statutory eligibility, approval, rejection, penalties and entitlements.


## Model / prompt / tool / evaluation governance
Every production AI capability must pin model identifier/version, prompt ID/version/hash, allowed toolset version/scopes, evaluation dataset/version, safety/privacy results, quality thresholds, cost/latency budget and fallback behavior. Model or prompt changes are release changes and must rerun applicable evaluations.
