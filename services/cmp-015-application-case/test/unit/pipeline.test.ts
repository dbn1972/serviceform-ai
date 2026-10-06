import { describe, expect, it } from 'vitest';
import { Cmp015Error } from '../../src/errors.js';
import {
  CommandPipeline,
  isCommitReceipt,
  WorkflowAdvanceGate,
  type CommitReceipt,
} from '../../src/pipeline.js';
import {
  guardOutboundPort,
  inDomainTransaction,
  runInDomainTransaction,
} from '../../src/tx-scope.js';
import { CITIZEN, pinsFor, RecordingWorkflow, T1, TSB_T1 } from '../doubles/fixtures.js';

function pipeline(): CommandPipeline {
  return new CommandPipeline({
    tenantId: T1,
    applicationId: CITIZEN,
    commandType: 'SUBMIT',
    idempotencyKey: 'cmd-000001',
    correlationId: CITIZEN,
  });
}

function code(fn: () => unknown): string {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return `${(e as Cmp015Error).code}:${(e as Cmp015Error).details?.[0]?.code ?? ''}`;
  }
}

function toCommitted(p: CommandPipeline): CommitReceipt {
  p.authorized(CITIZEN, 'rev-1');
  p.validated('READY_TO_SUBMIT', pinsFor(TSB_T1));
  p.domainTxnOpened();
  p.caseMutated();
  p.outboxWritten();
  return p.committed(3);
}

const signal = {
  to_state: 'SUBMITTED',
  transition_key: 'READY_TO_SUBMIT>SUBMITTED',
  workflow_version_id: pinsFor(TSB_T1).workflow_version_id,
  idempotency_key: `${CITIZEN}:3`,
  correlation_id: CITIZEN,
};

describe('command pipeline ordering (SF-CON-COMMAND-TRANSITION)', () => {
  it('advances phase by phase and produces a committed record', () => {
    const p = pipeline();
    expect(p.phase).toBeNull();
    const receipt = toCommitted(p);
    expect(isCommitReceipt(receipt)).toBe(true);
    expect(p.record()).toMatchObject({
      phase: 'DOMAIN_COMMITTED',
      domain_committed: true,
      temporal_advanced: false,
    });
  });

  it('NEGATIVE: phases cannot be skipped or repeated (no commit before outbox, no Temporal before commit)', () => {
    const p = pipeline();
    expect(code(() => p.validated('DRAFT', pinsFor(TSB_T1)))).toBe('SF-WF-001:COMMAND_PHASE_ORDER');
    p.authorized(CITIZEN, 'rev-1');
    p.validated('DRAFT', pinsFor(TSB_T1));
    p.domainTxnOpened();
    expect(code(() => p.committed(2))).toBe('SF-WF-001:COMMAND_PHASE_ORDER');
    expect(code(() => p.record())).toBe('OK');
    expect(p.record()).toMatchObject({
      phase: 'DOMAIN_TXN',
      domain_committed: false,
      temporal_advanced: false,
    });
    expect(code(() => pipeline().record())).toBe('SF-SYS-001:COMMAND_RECORD_INCOMPLETE');
  });

  it('NEGATIVE: a commit receipt cannot be issued inside an open domain transaction', async () => {
    const p = pipeline();
    p.authorized(CITIZEN, 'rev-1');
    p.validated('DRAFT', pinsFor(TSB_T1));
    p.domainTxnOpened();
    p.caseMutated();
    p.outboxWritten();
    await expect(runInDomainTransaction(async () => p.committed(2))).rejects.toMatchObject({
      code: 'SF-SYS-001',
    });
  });

  it('NEGATIVE: a forged receipt or a receipt from another command cannot advance Temporal', async () => {
    const wf = new RecordingWorkflow();
    const gate = new WorkflowAdvanceGate(wf);
    const p = pipeline();
    toCommitted(p);
    const forged = { tenantId: T1, applicationId: CITIZEN, aggregateVersion: 3 };
    await expect(gate.advance(p, forged, signal)).rejects.toMatchObject({ code: 'SF-WF-001' });
    const other = pipeline();
    const otherReceipt = toCommitted(other);
    await expect(gate.advance(p, otherReceipt, signal)).rejects.toMatchObject({
      code: 'SF-WF-001',
    });
    expect(wf.signals.filter((s) => s.aggregate_version === 3)).toHaveLength(1);
  });

  it('NEGATIVE: the gate refuses to run inside a domain transaction', async () => {
    const wf = new RecordingWorkflow();
    const gate = new WorkflowAdvanceGate(wf);
    const p = pipeline();
    const receipt = toCommitted(p);
    await expect(
      runInDomainTransaction(() => gate.advance(p, receipt, signal)),
    ).rejects.toMatchObject({ code: 'SF-SYS-001' });
    expect(wf.signals).toHaveLength(0);
    expect(await gate.advance(p, receipt, signal)).toBe('SIGNALLED');
    expect(p.record()).toMatchObject({
      phase: 'TEMPORAL_ADVANCE',
      temporal_advanced: true,
      domain_committed: true,
    });
  });
});

describe('outbound port guard (Constitution #11)', () => {
  it('passes non-function members through and refuses calls inside a domain transaction', async () => {
    const port = {
      name: 'x',
      async ping() {
        return 'pong';
      },
    };
    const guarded = guardOutboundPort('test', port);
    expect(guarded.name).toBe('x');
    expect(await guarded.ping()).toBe('pong');
    expect(inDomainTransaction()).toBe(false);
    await expect(runInDomainTransaction(async () => guarded.ping())).rejects.toBeInstanceOf(
      Cmp015Error,
    );
  });
});
