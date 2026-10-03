import { describe, expect, it } from 'vitest';
import { buildConnectorEnvelope } from '../src/events.js';

describe('event builders', () => {
  it('rejects an invalid envelope and keeps data free of secret_ref', () => {
    expect(() =>
      buildConnectorEnvelope({
        event_id: 'not-a-uuid',
        event_type: 'ConnectorInvocationStarted',
        tenant_id: '11111111-1111-4111-8111-111111111111',
        cell_id: 'cell-01',
        aggregate_id: '11111111-1111-4111-8111-111111111111',
        aggregate_version: 1,
        occurred_at: '2026-10-03T00:00:00.000Z',
        correlation_id: '11111111-1111-4111-8111-111111111111',
        actor: { type: 'INTEGRATION', id: '11111111-1111-4111-8111-111111111111' },
        data: {
          connector_binding_id: '11111111-1111-4111-8111-111111111111',
          connector_type: 'DEPARTMENT_API',
          direction: 'INVOKE',
          mode: 'SIMULATED',
          attempts: 0,
        },
      }),
    ).toThrow(/envelope/);
    const ok = buildConnectorEnvelope({
      event_id: '11111111-1111-4111-8111-111111111111',
      event_type: 'ConnectorInvocationStarted',
      tenant_id: '11111111-1111-4111-8111-111111111111',
      cell_id: 'cell-01',
      aggregate_id: '11111111-1111-4111-8111-111111111111',
      aggregate_version: 1,
      occurred_at: '2026-10-03T00:00:00.000Z',
      correlation_id: '11111111-1111-4111-8111-111111111111',
      actor: { type: 'INTEGRATION', id: '11111111-1111-4111-8111-111111111111' },
      data: {
        connector_binding_id: '11111111-1111-4111-8111-111111111111',
        connector_type: 'DEPARTMENT_API',
        direction: 'INVOKE',
        mode: 'SIMULATED',
        attempts: 0,
      },
    });
    expect(JSON.stringify(ok.data)).not.toMatch(/vault:\/\//);
  });
});
