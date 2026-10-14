import { randomUUID } from 'node:crypto';
import { createDigilockerApi } from '../../src/api/handler.js';
import { DigiLockerService } from '../../src/service/service.js';
import { SimulatedDigiLockerConnector } from '../../src/connectors/simulated-digilocker.js';
import type { SimulationMarker } from '../../src/domain/simulation.js';
import type { TenantContext } from '../../src/types.js';
import {
  AllowAllAuthorizer,
  BINDING_ID,
  TENANT_A,
  ACTOR_SYSTEM,
  TEST_RUN_ID,
  FakeConnectorBindingPort,
} from './fixtures.js';
import { MemoryDigilockerRepository } from './memory-repo.js';

export interface HarnessState {
  ctx: TenantContext;
}

export interface Harness {
  state: HarnessState;
  repo: MemoryDigilockerRepository;
  call(
    method: string,
    path: string,
    body?: unknown,
    opts?: { headers?: Record<string, string> },
  ): Promise<{ status: number; body: unknown }>;
}

export function makeHarness(opts: { scenario?: string; env?: 'LOCAL' | 'CI' } = {}): Harness {
  const env = opts.env ?? 'LOCAL';
  const simulationMarker: SimulationMarker = {
    simulation: true,
    scenario: opts.scenario ?? 'digilocker_publish',
    test_run_id: TEST_RUN_ID,
    connector_binding_id: BINDING_ID,
    environment: env,
  };

  const repo = new MemoryDigilockerRepository();
  const authorizer = new AllowAllAuthorizer();
  const connectorBinding = new FakeConnectorBindingPort(env);
  const digilockerApi = new SimulatedDigiLockerConnector(simulationMarker);

  const state: HarnessState = {
    ctx: {
      tenant_id: TENANT_A,
      cell_id: 'cell-01',
      actor: { type: 'SYSTEM', id: ACTOR_SYSTEM },
      roles: [],
      jurisdiction_ids: [],
      auth_assurance: 'WORKLOAD_IDENTITY',
      correlation_id: randomUUID(),
      trace_id: '0af7651916cd43dd8448eb211c80319c',
    },
  };

  const service = new DigiLockerService({
    repo,
    authorizer,
    connectorBinding,
    digilockerApi,
    runtimeEnvironment: env,
    clock: () => new Date('2026-10-14T05:00:00Z'),
  });

  const api = createDigilockerApi({
    service,
    resolveContext: async () => state.ctx,
  });

  return {
    state,
    repo,
    call: async (method, path, body, callOpts) => {
      const resp = await api.handle({
        method,
        path,
        headers: {
          'idempotency-key': randomUUID(),
          ...callOpts?.headers,
        },
        body,
      });
      return { status: resp.status, body: resp.body };
    },
  };
}
