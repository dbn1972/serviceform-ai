export type TransportMode = 'REAL' | 'SIMULATED';

export type PublishKind = 'ok' | 'retryable' | 'fatal';

export interface OutgoingMessage {
  topic: string;
  key: string;
  value: string;
  headers: Record<string, string>;
}

export interface PublishOutcome {
  kind: PublishKind;
  errorCode?: string;
}

export interface IncomingMessage {
  topic: string;
  partition: number;
  offset: string;
  key: string;
  value: string;
  headers: Record<string, string>;
}

export type MessageHandler = (msg: IncomingMessage) => Promise<void>;

export interface Subscription {
  close(): Promise<void>;
}

export interface TopicCreateSpec {
  topic: string;
  partitions: number;
  replicationFactor: number;
}

export interface EventTransport {
  readonly mode: TransportMode;
  publish(msgs: OutgoingMessage[], o: { timeoutMs: number }): Promise<PublishOutcome[]>;
  ensureTopics(defs: TopicCreateSpec[]): Promise<void>;
  subscribe(group: string, topics: string[], h: MessageHandler): Promise<Subscription>;
  logEndOffsets(topic: string): Promise<Map<number, bigint>>;
  committedOffsets(group: string, topic: string): Promise<Map<number, bigint>>;
  close(): Promise<void>;
}

const SIMULATED_ENVIRONMENTS = new Set(['LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE']);

/** INT-013 / D-04: SIMULATED transport refused unless SF_ENVIRONMENT is an exact allowlisted value. */
export function assertSimulatedTransportAllowed(environment: string | undefined): void {
  if (environment === undefined || !SIMULATED_ENVIRONMENTS.has(environment)) {
    throw new Error('SIMULATED transport refused for this environment');
  }
}
