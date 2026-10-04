import { describe, expect, it } from 'vitest';
import { assertAgentPackagingPaths } from '../src/agent-packaging.js';

describe('agent-packaging', () => {
  it('allows approved instruction surfaces', () => {
    expect(
      assertAgentPackagingPaths([
        'AGENTS.md',
        '.cursor/rules/architecture.mdc',
        'prompts/07_MULTI_AGENT_ORCHESTRATOR.md',
        'orchestrator/handovers/SF-M01-W2-005.yaml',
      ]),
    ).toEqual([]);
  });

  it('refuses frozen shared contracts and arbitrary domain paths', () => {
    const findings = assertAgentPackagingPaths([
      'contracts/shared/event-envelope.schema.json',
      'services/cmp-002-tenant-organisation/src/index.ts',
    ]);
    expect(findings).toHaveLength(2);
  });
});
