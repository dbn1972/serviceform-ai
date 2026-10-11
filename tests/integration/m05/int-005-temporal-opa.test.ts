import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertCommitted } from '../../../services/cmp-016-workflow-engine/src/domain/signals.js';

const ROOT = join(import.meta.dirname, '../../..');

describe('INT-005 Temporal after CMP-015 commit; OPA on officer action (independent)', () => {
  it('CMP-016 refuses uncommitted signals (Temporal cannot skip CMP-015 commit)', () => {
    const base = {
      signal_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      source_component: 'CMP-015' as const,
      tenant_id: '11111111-1111-4111-8111-111111111111',
      application_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      workflow_version_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      command_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      outcome: 'SUBMIT',
      phase: 'DOMAIN_COMMITTED' as const,
      domain_committed: true,
      outbox_event_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    };
    for (const bad of [
      { ...base, domain_committed: false },
      { ...base, phase: 'TEMPORAL_ADVANCE' as const },
      { ...base, outbox_event_id: 'not-a-uuid' },
    ]) {
      expect(() => assertCommitted(bad as never)).toThrow();
    }
    expect(() => assertCommitted(base)).not.toThrow();
  });

  it('CMP-016 Temporal adapter calls assertCommitted before client.signal', () => {
    const adapter = readFileSync(
      join(ROOT, 'services/cmp-016-workflow-engine/src/temporal/adapter.ts'),
      'utf8',
    );
    expect(adapter).toContain('assertCommitted(signal)');
    expect(adapter).toMatch(
      /async advance\([\s\S]*assertCommitted\(signal\)[\s\S]*this\.client\.signal/,
    );
  });

  it('CMP-016 service authorizes before write path', () => {
    const svc = readFileSync(
      join(ROOT, 'services/cmp-016-workflow-engine/src/service/workflow-service.ts'),
      'utf8',
    );
    expect(svc).toMatch(/authorize -> short PostgreSQL transaction/);
    expect(svc).toContain('this.deps.authz.authorize');
  });

  it('CMP-017 officer claim/complete goes through authz (OPA)', () => {
    const tasks = readFileSync(
      join(ROOT, 'services/cmp-017-work-queue-tasks/src/service/task-service.ts'),
      'utf8',
    );
    expect(tasks).toMatch(/authorize|authz/i);
    const authz = readFileSync(
      join(ROOT, 'services/cmp-017-work-queue-tasks/src/authz.ts'),
      'utf8',
    );
    expect(authz.length).toBeGreaterThan(50);
  });

  it('CMP-015 host mount exists; CMP-016 has no host HTTP surface', () => {
    const m05 = readFileSync(join(ROOT, 'apps/api/src/composition/m05.ts'), 'utf8');
    expect(m05).toMatch(/CMP-016 workflow engine has no Fastify\/HTTP registration surface/);
    expect(m05).toContain('registerApplicationCaseRoutes');
    expect(m05).not.toMatch(/registerWorkflow/);
  });
});
