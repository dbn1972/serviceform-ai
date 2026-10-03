import { describe, expect, it, vi } from 'vitest';
import { AuditSinkUnavailableError, HttpAuditSink, requireAudit } from '../src/index.js';

describe('HttpAuditSink', () => {
  it('retries 503 then succeeds (S3)', async () => {
    let n = 0;
    const sink = new HttpAuditSink({
      baseUrl: 'http://audit.example',
      delayMs: 1,
      retries: 3,
      fetchImpl: async () => {
        n += 1;
        if (n < 3) return new Response('no', { status: 503 });
        return new Response(
          JSON.stringify({
            audit_id: 'c06d4ebf-17d3-4a5f-a8c0-f3be9fd17c4c',
            chain_seq: 1,
            recorded_at: '2026-10-03T09:00:00.000Z',
          }),
          { status: 201 },
        );
      },
    });
    const out = await sink.submit(
      {
        audit_id: 'c06d4ebf-17d3-4a5f-a8c0-f3be9fd17c4c',
        occurred_at: '2026-10-03T09:00:00Z',
        tenant_id: '11111111-1111-4111-8111-111111111111',
        cell_id: 'cell-01',
        actor_type: 'SYSTEM',
        actor_id: '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42',
        action: 'EXAMPLE_WRITE',
        resource_type: 'ExampleAggregate',
        resource_id: '9d3a1b8c-e4a0-4d2c-b59d-c08b6cae4f19',
        correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
        trace_id: '0af7651916cd43dd8448eb211c80319c',
        result: 'SUCCESS',
      },
      '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
    );
    expect(out.chain_seq).toBe(1);
    expect(n).toBe(3);
  });

  it('throws AuditSinkUnavailableError when 503 persists', async () => {
    const sink = new HttpAuditSink({
      baseUrl: 'http://audit.example',
      delayMs: 1,
      retries: 2,
      fetchImpl: async () => new Response('no', { status: 503 }),
    });
    await expect(
      sink.submit(
        {
          audit_id: 'c06d4ebf-17d3-4a5f-a8c0-f3be9fd17c4c',
          occurred_at: '2026-10-03T09:00:00Z',
          tenant_id: '11111111-1111-4111-8111-111111111111',
          cell_id: 'cell-01',
          actor_type: 'SYSTEM',
          actor_id: '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42',
          action: 'EXAMPLE_WRITE',
          resource_type: 'ExampleAggregate',
          resource_id: 'x',
          correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
          trace_id: '0af7651916cd43dd8448eb211c80319c',
          result: 'SUCCESS',
        },
        '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
      ),
    ).rejects.toBeInstanceOf(AuditSinkUnavailableError);
  });
});

describe('requireAudit', () => {
  it('blocks PRIVILEGED when write fails', async () => {
    const act = vi.fn(async () => 'ok');
    await expect(
      requireAudit(
        'PRIVILEGED',
        async () => {
          throw new AuditSinkUnavailableError();
        },
        act,
      ),
    ).rejects.toBeInstanceOf(AuditSinkUnavailableError);
    expect(act).not.toHaveBeenCalled();
  });
});
