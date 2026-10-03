import { GENESIS_HASH_HEX, hashChainRow } from '@serviceform/audit-client';
import { describe, expect, it } from 'vitest';
import { verifyPlatformChain, verifyTenantChain } from '../../src/domain/verify-chain.js';
import { sampleEvent, T1 } from '../support/fixtures.js';
import { createLedgerState, createMockClient, type StoredLedgerRow } from '../support/mock-pool.js';

const recorded = new Date('2026-10-03T12:00:00.000Z');
const genesis = Buffer.from(GENESIS_HASH_HEX, 'hex');

function validRow(tenantId: string | null, event = sampleEvent()): StoredLedgerRow {
  const rowHash = hashChainRow({
    tenant_id: tenantId,
    chain_seq: 1,
    recorded_at: recorded.toISOString(),
    audit_id: event.audit_id,
    event,
    prev_hash_hex: GENESIS_HASH_HEX,
  });
  return {
    tenant_id: tenantId,
    chain_seq: '1',
    recorded_at: recorded,
    audit_id: event.audit_id,
    record: event,
    prev_hash: genesis,
    row_hash: rowHash,
  };
}

describe('verifyTenantChain', () => {
  it('accepts a linked tenant chain whose head matches the tail', async () => {
    const row = validRow(T1);
    const state = createLedgerState({
      tenantEvents: [row],
      tenantHeads: new Map([
        [T1, { last_seq: '1', last_hash: row.row_hash, last_recorded_at: recorded }],
      ]),
    });
    const report = await verifyTenantChain(createMockClient(state), T1);
    expect(report).toMatchObject({ ok: true, length: 1 });
  });

  it('reports seq gap, prev-hash, row-hash, and head mismatches', async () => {
    const event = sampleEvent();
    const base = validRow(T1, event);
    const gapped: StoredLedgerRow = { ...base, chain_seq: '3' };
    const prev: StoredLedgerRow = { ...base, prev_hash: Buffer.alloc(32, 1) };
    const hashed: StoredLedgerRow = { ...base, row_hash: Buffer.alloc(32, 2) };

    const gap = await verifyTenantChain(
      createMockClient(createLedgerState({ tenantEvents: [gapped] })),
      T1,
    );
    expect(gap.findings.some((f) => f.kind === 'SEQ_GAP')).toBe(true);

    const prevReport = await verifyTenantChain(
      createMockClient(createLedgerState({ tenantEvents: [prev] })),
      T1,
    );
    expect(prevReport.findings.some((f) => f.kind === 'PREV_HASH')).toBe(true);

    const hashReport = await verifyTenantChain(
      createMockClient(createLedgerState({ tenantEvents: [hashed] })),
      T1,
    );
    expect(hashReport.findings.some((f) => f.kind === 'HASH_MISMATCH')).toBe(true);

    const head = await verifyTenantChain(
      createMockClient(
        createLedgerState({
          tenantEvents: [base],
          tenantHeads: new Map([
            [T1, { last_seq: '99', last_hash: base.row_hash, last_recorded_at: recorded }],
          ]),
        }),
      ),
      T1,
    );
    expect(head.findings.some((f) => f.kind === 'HEAD_MISMATCH')).toBe(true);
  });

  it('reports a head without rows and allows an empty chain with no head', async () => {
    const emptyHead = await verifyTenantChain(
      createMockClient(
        createLedgerState({
          tenantHeads: new Map([
            [T1, { last_seq: '4', last_hash: genesis, last_recorded_at: recorded }],
          ]),
        }),
      ),
      T1,
    );
    expect(emptyHead.findings).toEqual([
      expect.objectContaining({ kind: 'HEAD_MISMATCH', detail: 'head without rows' }),
    ]);
    const empty = await verifyTenantChain(createMockClient(createLedgerState()), T1);
    expect(empty).toMatchObject({ ok: true, length: 0 });
  });
});

describe('verifyPlatformChain', () => {
  it('accepts a valid platform chain and flags a broken one', async () => {
    const row = validRow(null);
    const ok = await verifyPlatformChain(
      createMockClient(
        createLedgerState({
          platformEvents: [row],
          platformHead: { last_seq: '1', last_hash: row.row_hash, last_recorded_at: recorded },
        }),
      ),
    );
    expect(ok.ok).toBe(true);
    const broken = await verifyPlatformChain(
      createMockClient(
        createLedgerState({
          platformEvents: [{ ...row, row_hash: Buffer.alloc(32, 8) }],
          platformHead: { last_seq: '1', last_hash: row.row_hash, last_recorded_at: recorded },
        }),
      ),
    );
    expect(broken.ok).toBe(false);
    expect(broken.findings.map((f) => f.kind)).toEqual(expect.arrayContaining(['HASH_MISMATCH']));
  });
});
