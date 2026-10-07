import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertNoOpenDomainTransaction,
  guardOutboundPort,
  inDomainTransaction,
  runInDomainTransaction,
} from '../../../services/cmp-015-application-case/src/tx-scope.js';

const ROOT = join(import.meta.dirname, '../../..');

describe('INT-004 submission hot path txn/outbox (independent)', () => {
  it('CMP-015 domain txn refuses network/outbound ports while open', async () => {
    expect(inDomainTransaction()).toBe(false);
    await runInDomainTransaction(async () => {
      expect(inDomainTransaction()).toBe(true);
      try {
        assertNoOpenDomainTransaction('workflow-advance');
        expect.fail('expected NETWORK_IO_IN_DOMAIN_TX');
      } catch (err) {
        const e = err as { code?: string; details?: Array<{ code?: string }> };
        expect(e.code).toBe('SF-SYS-001');
        expect(e.details?.some((d) => d.code === 'NETWORK_IO_IN_DOMAIN_TX')).toBe(true);
      }
      const guarded = guardOutboundPort('workflow', {
        advance: async () => 'ok',
      });
      try {
        void guarded.advance();
        expect.fail('expected guarded outbound port to throw');
      } catch (err) {
        expect((err as { code?: string }).code).toBe('SF-SYS-001');
      }
    });
    expect(inDomainTransaction()).toBe(false);
  });

  it('pipeline orders case change → outbox → commit → Temporal (Constitution #10/#11)', () => {
    const pipeline = readFileSync(
      join(ROOT, 'services/cmp-015-application-case/src/pipeline.ts'),
      'utf8',
    );
    expect(pipeline).toMatch(/case change -> outbox -> commit -> only then Temporal/);
    expect(pipeline).toContain('outboxWritten()');
    expect(pipeline).toContain("assertNoOpenDomainTransaction('workflow-advance')");
    expect(pipeline).toContain("assertNoOpenDomainTransaction('commit-receipt')");
  });

  it('workflow-advance default relies on committed outbox, not in-txn Temporal', () => {
    const advance = readFileSync(
      join(ROOT, 'services/cmp-015-application-case/src/ports/workflow-advance.ts'),
      'utf8',
    );
    expect(advance).toMatch(/committed outbox event is the durable trigger/);
    expect(advance).not.toMatch(/await\s+temporal/i);
  });

  it('SUBMIT path writes outbox inside domain transaction in service.ts', () => {
    const service = readFileSync(
      join(ROOT, 'services/cmp-015-application-case/src/service.ts'),
      'utf8',
    );
    expect(service).toContain('runInDomainTransaction');
    expect(service).toContain('insertOutbox');
    expect(service).toContain('pipeline.outboxWritten()');
  });
});
