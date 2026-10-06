import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgGrievanceStore } from '../../src/store/pg-store.js';
import { GrievanceFeedbackService } from '../../src/service.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { FixedRouting, SilentNotification, RecordingWorkflow } from '../doubles/fixtures.js';
import { CITIZEN, ctx, key, OFFICER, T1, T2 } from '../doubles/fixtures.js';
import { closeHarness, setupHarness, type Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

describe('CMP-027 service flow against real PostgreSQL', () => {
  it('files, categorises, and AI cannot close; wrong tenant sees nothing', async () => {
    const store = new PgGrievanceStore(h.rt);
    const authorizer = new ContractAuthorizer();
    const service = new GrievanceFeedbackService({
      store,
      authorizer,
      routing: new FixedRouting(),
      workflow: new RecordingWorkflow(),
      notification: new SilentNotification(),
    });
    const filed = await service.file(ctx(T1, 'CITIZEN', CITIZEN), {}, key('pg-file'), 'GRIEVANCE');
    const id = (filed.body as { grievance: { grievance_id: string } }).grievance.grievance_id;
    await service.executeCommand(
      ctx(T1, 'OFFICER', OFFICER),
      id,
      {
        command: 'CATEGORISE',
        expected_status: 'FILED',
        expected_version: 1,
        category_code: 'DELAY',
      },
      key('pg-cat'),
    );
    await expect(
      service.executeCommand(
        ctx(T1, 'INTEGRATION', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', {
          purpose: 'AI_ASSISTANCE',
        }),
        id,
        { command: 'RESOLVE', expected_status: 'CATEGORISED', expected_version: 2 },
        key('pg-ai'),
      ),
    ).rejects.toMatchObject({ details: [{ code: 'AI_FINAL_DISPOSITION_FORBIDDEN' }] });
    await expect(service.get(ctx(T2, 'OFFICER', OFFICER), id)).rejects.toMatchObject({
      code: 'SF-SYS-002',
    });
  });
});
