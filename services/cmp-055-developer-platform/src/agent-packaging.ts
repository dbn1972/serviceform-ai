/**
 * AI agent instruction packaging may only reference approved governance surfaces.
 * Complements scripts/gates/agent_rules_gate.py (Eng v1.4 CMP-055 / s13).
 */

export const APPROVED_AGENT_PATH_PREFIXES = [
  'AGENTS.md',
  'CLAUDE.md',
  'ARCHITECTURE-CONSTITUTION.md',
  'MULTI-AGENT-DEVELOPMENT.md',
  'CLAUDE-MULTI-AGENT-GUIDE.md',
  'MODEL-ROUTING-QUALITY.md',
  'MASTER_CURSOR_PROMPT.md',
  '.github/copilot-instructions.md',
  '.cursor/rules/',
  '.claude/agents/',
  'prompts/',
  'orchestrator/templates/',
  'orchestrator/handovers/',
  'orchestrator/tasks/',
  'specs/agent-',
  'docs/engineering/',
] as const;

export type AgentPackagingFinding = { path: string; message: string };

export function assertAgentPackagingPaths(paths: string[]): AgentPackagingFinding[] {
  const findings: AgentPackagingFinding[] = [];
  for (const path of paths) {
    const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
    if (normalized.startsWith('contracts/') || normalized === 'ARCHITECTURE-CONSTITUTION.md') {
      // Constitution may be cited; contracts/shared must never be packaged as editable agent output.
      if (normalized.startsWith('contracts/shared/')) {
        findings.push({
          path: normalized,
          message:
            'frozen shared contracts must not be packaged as agent-writable instruction paths',
        });
        continue;
      }
    }
    const ok = APPROVED_AGENT_PATH_PREFIXES.some(
      (prefix) => normalized === prefix || normalized.startsWith(prefix),
    );
    if (!ok) {
      findings.push({
        path: normalized,
        message: 'path is outside approved agent instruction packaging prefixes',
      });
    }
  }
  return findings;
}
