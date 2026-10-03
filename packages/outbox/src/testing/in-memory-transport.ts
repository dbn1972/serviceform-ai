import { partitionForKey } from '../transport/partitioner.js';
import { assertSimulatedTransportAllowed } from '../transport/types.js';
import type {
  EventTransport,
  IncomingMessage,
  MessageHandler,
  OutgoingMessage,
  PublishOutcome,
  Subscription,
  TopicCreateSpec,
} from '../transport/types.js';

interface PartitionLog {
  records: { offset: bigint; key: string; value: string; headers: Record<string, string> }[];
}

interface TopicState {
  partitions: PartitionLog[];
}

interface GroupState {
  offsets: Map<string, Map<number, bigint>>;
}

export interface InMemoryTransportOptions {
  environment?: string | undefined;
  defaultPartitions?: number;
}

export class InMemoryTransport implements EventTransport {
  readonly mode = 'SIMULATED' as const;
  private readonly topics = new Map<string, TopicState>();
  private readonly groups = new Map<string, GroupState>();
  private downFlag = false;
  private failQueue: PublishOutcome['kind'][] = [];
  private readonly defaultPartitions: number;
  private readonly handlers: { group: string; topics: string[]; h: MessageHandler }[] = [];

  constructor(options: InMemoryTransportOptions = {}) {
    assertSimulatedTransportAllowed(options.environment);
    this.defaultPartitions = options.defaultPartitions ?? 6;
  }

  down(): void {
    this.downFlag = true;
  }

  up(): void {
    this.downFlag = false;
  }

  failNext(n: number, kind: PublishOutcome['kind']): void {
    for (let i = 0; i < n; i += 1) this.failQueue.push(kind);
  }

  async ensureTopics(defs: TopicCreateSpec[]): Promise<void> {
    for (const def of defs) {
      if (!this.topics.has(def.topic)) {
        this.topics.set(def.topic, {
          partitions: Array.from({ length: def.partitions }, () => ({ records: [] })),
        });
      }
    }
  }

  async publish(msgs: OutgoingMessage[], _o: { timeoutMs: number }): Promise<PublishOutcome[]> {
    const out: PublishOutcome[] = [];
    for (const msg of msgs) {
      if (this.downFlag) {
        out.push({ kind: 'retryable', errorCode: 'BROKER_UNAVAILABLE' });
        continue;
      }
      const queued = this.failQueue.shift();
      if (queued && queued !== 'ok') {
        out.push({
          kind: queued,
          errorCode: queued === 'fatal' ? 'RECORD_INVALID' : 'BROKER_UNAVAILABLE',
        });
        continue;
      }
      let topic = this.topics.get(msg.topic);
      if (!topic) {
        topic = {
          partitions: Array.from({ length: this.defaultPartitions }, () => ({ records: [] })),
        };
        this.topics.set(msg.topic, topic);
      }
      const p = partitionForKey(msg.key, topic.partitions.length);
      const log = topic.partitions[p];
      if (!log) {
        out.push({ kind: 'retryable', errorCode: 'NOT_LEADER' });
        continue;
      }
      const offset = BigInt(log.records.length);
      log.records.push({ offset, key: msg.key, value: msg.value, headers: { ...msg.headers } });
      out.push({ kind: 'ok' });
    }
    return out;
  }

  async subscribe(group: string, topics: string[], h: MessageHandler): Promise<Subscription> {
    this.handlers.push({ group, topics, h });
    return { close: async () => {} };
  }

  /** Deliver every unpublished record for a group (test helper). */
  async drain(group: string, handler: MessageHandler, topics?: string[]): Promise<number> {
    const g = this.groups.get(group) ?? { offsets: new Map() };
    this.groups.set(group, g);
    let n = 0;
    for (const [topicName, state] of this.topics) {
      if (topics && !topics.includes(topicName)) continue;
      let committed = g.offsets.get(topicName);
      if (!committed) {
        committed = new Map();
        g.offsets.set(topicName, committed);
      }
      for (let p = 0; p < state.partitions.length; p += 1) {
        const log = state.partitions[p];
        if (!log) continue;
        const next = committed.get(p) ?? 0n;
        for (const rec of log.records) {
          if (rec.offset < next) continue;
          const msg: IncomingMessage = {
            topic: topicName,
            partition: p,
            offset: rec.offset.toString(),
            key: rec.key,
            value: rec.value,
            headers: rec.headers,
          };
          await handler(msg);
          committed.set(p, rec.offset + 1n);
          n += 1;
        }
      }
    }
    return n;
  }

  async redeliver(group: string, handler: MessageHandler): Promise<number> {
    const g = this.groups.get(group);
    if (g) g.offsets.clear();
    return this.drain(group, handler);
  }

  async logEndOffsets(topic: string): Promise<Map<number, bigint>> {
    const state = this.topics.get(topic);
    const map = new Map<number, bigint>();
    if (!state) return map;
    state.partitions.forEach((p, i) => map.set(i, BigInt(p.records.length)));
    return map;
  }

  async committedOffsets(group: string, topic: string): Promise<Map<number, bigint>> {
    return new Map(this.groups.get(group)?.offsets.get(topic) ?? []);
  }

  async close(): Promise<void> {
    this.handlers.length = 0;
  }
}
