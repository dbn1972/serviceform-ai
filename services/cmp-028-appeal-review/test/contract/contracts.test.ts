import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate } from '../../src/contracts.js';
import { EVENT_TYPE } from '../../src/domain/states.js';
import { TOPIC_DOMAIN } from '../../src/outbox.js';
import { ctxFor, fileBody, CITIZEN_1, OFFICER_1 } from '../doubles/fixtures.js';
import { idem, makeService, type Ctx } from '../doubles/harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../..');

const LOCKED = [
  'SF-CON-AUDIT-EVENT',
  'SF-CON-AUTHZ-DECISION',
  'SF-CON-COMMON',
  'SF-CON-CONNECTOR-BINDING',
  'SF-CON-ERROR-RESPONSE',
  'SF-CON-EVENT-ENVELOPE',
  'SF-CON-IDEMPOTENCY',
  'SF-CON-ISOLATION-DECLARATION',
  'SF-CON-REQUEST-CONTEXT',
  'SF-CON-SIMULATION-MARKER',
  'SF-CON-ERROR-CATALOGUE',
  'SF-CON-DB-SESSION-CONTEXT',
  'SF-CON-OUTBOX',
  'SF-CON-APPLICATION-CASE-SM',
  'SF-CON-WORKFLOW-MODEL',
  'SF-CON-COMMAND-TRANSITION',
  'SF-CON-HUMAN-TASK',
  'SF-CON-SLA-CLOCK',
  'SF-CON-VERSION-PINNING',
] as const;

describe('19 frozen contracts remain FROZEN (read-only consumption)', () => {
  it('lock lists exactly the 19 ids this envelope consumes', () => {
    const text = readFileSync(join(repoRoot, 'orchestrator/contracts-lock.yaml'), 'utf8');
    const ids = [...text.matchAll(/^\s+- id: (SF-CON-[A-Z0-9-]+)/gm)].map((m) => m[1]);
    expect(ids).toEqual([...LOCKED]);
    expect(text.match(/status: FROZEN/g)?.length).toBe(19);
  });

  it('emitted domain events are valid SF-CON-EVENT-ENVELOPE instances', async () => {
    const { service, repo } = makeService();
    const citizen = ctxFor(CITIZEN_1, { roles: ['CITIZEN'] }, 'CITIZEN') as Ctx;
    const officer = ctxFor(OFFICER_1) as Ctx;
    const filed = await service.fileAppeal(citizen, fileBody(), idem('POST /v1/appeals'));
    await service.recordAdmissibility(
      officer,
      filed.body.appeal_id,
      { admissibility_code: 'NOT_ADMITTED', reason_code: 'OUT_OF_TIME' },
      idem('POST /adm'),
    );
    for (const env of repo.outboxOf(TOPIC_DOMAIN)) {
      expect(validate('event-envelope', env).valid, env.event_type).toBe(true);
      expect(Object.values(EVENT_TYPE)).toContain(env.event_type);
    }
  });
});
