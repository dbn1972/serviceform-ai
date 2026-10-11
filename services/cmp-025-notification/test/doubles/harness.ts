import { createNotificationApi, type ApiResponse } from '../../src/api/handler.js';
import { DefaultConnectorRegistry } from '../../src/connectors/registry.js';
import type {
  ChannelConnector,
  ChannelConnectorRegistry,
} from '../../src/ports/channel-connector.js';
import type { SimulatedScenario } from '../../src/connectors/simulated-channel.js';
import type { HubTransport } from '../../src/connectors/hub-channel.js';
import type { DeploymentEnvironment } from '../../src/domain/model.js';
import type { ConnectorBindingView } from '../../src/domain/simulation.js';
import { NotificationDeliveryWorker } from '../../src/service/delivery.js';
import { NotificationService } from '../../src/service/service.js';
import { RecordingLogger } from '../../src/logging.js';
import type { RequestContext, TenantContext } from '../../src/types.js';
import {
  AllowAllAuthorizer,
  BINDING_SMS,
  CANARY_ADDRESS,
  ctxFor,
  MapBindingPort,
  MapRecipientDirectory,
  MutableClock,
  simulatedBinding,
  TENANT_A,
} from './fixtures.js';
import { MemoryNotificationRepository } from './memory-repo.js';

export interface CallOptions {
  key?: string | null;
  headers?: Record<string, string>;
}

export interface HarnessOptions {
  startIso?: string;
  environment?: DeploymentEnvironment;
  scenarioFor?: (handleRef: string) => SimulatedScenario;
  testRunId?: string | undefined;
  hub?: HubTransport;
  binding?: ConnectorBindingView;
  noSimulation?: boolean;
  wrapConnector?: (c: ChannelConnector) => ChannelConnector;
}

export function makeHarness(opts: HarnessOptions = {}) {
  const repo = new MemoryNotificationRepository();
  const clock = new MutableClock(Date.parse(opts.startIso ?? '2026-10-10T10:00:00Z'));
  const authorizer = new AllowAllAuthorizer();
  const bindings = new MapBindingPort();
  const recipients = new MapRecipientDirectory();
  const logger = new RecordingLogger();
  const environment = opts.environment ?? 'CI';
  const registry = new DefaultConnectorRegistry({
    ...(opts.noSimulation
      ? {}
      : {
          simulation: {
            testRunId: opts.testRunId ?? 'run-cmp025-unit',
            ...(opts.scenarioFor ? { scenarioFor: opts.scenarioFor } : {}),
          },
        }),
    ...(opts.hub ? { hub: opts.hub } : {}),
  });
  const wrapped: ChannelConnectorRegistry = opts.wrapConnector
    ? {
        forBinding: (b) => {
          const c = registry.forBinding(b);
          return c === null
            ? null
            : (opts.wrapConnector as (x: ChannelConnector) => ChannelConnector)(c);
        },
      }
    : registry;
  bindings.bindings.set(BINDING_SMS, opts.binding ?? simulatedBinding({ environment }));
  recipients.addresses.set(`${TENANT_A}:handle.citizen.demo.001`, CANARY_ADDRESS);
  bindings.inTx = (): boolean => repo.inTransaction();
  recipients.inTx = (): boolean => repo.inTransaction();
  const service = new NotificationService({
    repo,
    authorizer,
    bindings,
    recipients,
    connectors: wrapped,
    environment,
    ...('testRunId' in opts && opts.testRunId === undefined
      ? {}
      : { testRunId: opts.testRunId ?? 'run-cmp025-unit' }),
    clock: clock.now,
    logger,
    workerId: 'worker-test-1',
  });
  const worker = new NotificationDeliveryWorker(service);
  const state: { ctx: TenantContext | RequestContext | null } = { ctx: ctxFor(TENANT_A) };
  const api = createNotificationApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
  let counter = 0;

  async function call(
    method: string,
    path: string,
    body?: unknown,
    callOpts: CallOptions = {},
  ): Promise<ApiResponse> {
    counter += 1;
    const headers: Record<string, string> = { ...(callOpts.headers ?? {}) };
    if (callOpts.key !== null) {
      headers['idempotency-key'] = callOpts.key ?? `test-key-${String(counter).padStart(6, '0')}`;
    }
    return api.handle({ method, path, headers, body });
  }

  return {
    repo,
    clock,
    authorizer,
    bindings,
    recipients,
    registry,
    logger,
    service,
    worker,
    state,
    api,
    call,
    environment,
  };
}

export type Harness = ReturnType<typeof makeHarness>;
