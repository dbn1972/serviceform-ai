import { Kafka, logLevel, type Admin, type Consumer, type IHeaders, type Producer } from 'kafkajs';
import type {
  EventTransport,
  IncomingMessage,
  MessageHandler,
  OutgoingMessage,
  PublishOutcome,
  Subscription,
  TopicCreateSpec,
} from './types.js';
import { partitionForKey } from './partitioner.js';

export interface KafkaTransportOptions {
  brokers: string[];
  clientId?: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause: unknown) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

function decodeHeaders(raw: IHeaders | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!raw) return headers;
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      headers[key] = value
        .map((item) => (Buffer.isBuffer(item) ? item.toString('utf8') : String(item)))
        .join(',');
      continue;
    }
    headers[key] = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  }
  return headers;
}

function isRetryable(message: string): boolean {
  return /timeout|unavailable|network|not.?leader|unknown.?topic|connection|econnrefused|enotfound|broker|disconnect|retr/i.test(
    message,
  );
}

export class KafkaTransport implements EventTransport {
  readonly mode = 'REAL' as const;
  private readonly brokers: string[];
  private readonly clientId: string;
  private client: Kafka | undefined;
  private producer: Producer | undefined;
  private admin: Admin | undefined;
  private readonly partitions = new Map<string, number>();
  private readonly consumers: Consumer[] = [];

  constructor(options: KafkaTransportOptions) {
    this.brokers = options.brokers;
    this.clientId = options.clientId ?? 'sf-cmp038';
  }

  private kafka(): Kafka {
    if (!this.client) {
      this.client = new Kafka({
        clientId: this.clientId,
        brokers: this.brokers,
        logLevel: logLevel.NOTHING,
        connectionTimeout: 3_000,
        requestTimeout: 5_000,
        retry: {
          retries: 1,
          initialRetryTime: 100,
          maxRetryTime: 1_000,
        },
      });
    }
    return this.client;
  }

  private async getProducer(): Promise<Producer> {
    if (!this.producer) {
      const producer = this.kafka().producer({
        idempotent: true,
        maxInFlightRequests: 1,
        allowAutoTopicCreation: false,
        retry: { retries: 1, initialRetryTime: 100, maxRetryTime: 1_000 },
      });
      await withTimeout(producer.connect(), 8_000, 'producer connect timeout');
      this.producer = producer;
    }
    return this.producer;
  }

  private async getAdmin(): Promise<Admin> {
    if (!this.admin) {
      const admin = this.kafka().admin();
      await withTimeout(admin.connect(), 8_000, 'admin connect timeout');
      this.admin = admin;
    }
    return this.admin;
  }

  async ensureTopics(defs: TopicCreateSpec[]): Promise<void> {
    const admin = await this.getAdmin();
    try {
      await admin.createTopics({
        waitForLeaders: true,
        topics: defs.map((d) => ({
          topic: d.topic,
          numPartitions: d.partitions,
          replicationFactor: d.replicationFactor,
        })),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!/already|exist/i.test(message)) throw cause;
    }
    for (const d of defs) this.partitions.set(d.topic, d.partitions);
  }

  async publish(msgs: OutgoingMessage[], o: { timeoutMs: number }): Promise<PublishOutcome[]> {
    if (msgs.length === 0) return [];
    try {
      const producer = await this.getProducer();
      const byTopic = new Map<string, OutgoingMessage[]>();
      for (const msg of msgs) {
        const list = byTopic.get(msg.topic) ?? [];
        list.push(msg);
        byTopic.set(msg.topic, list);
      }
      const send = producer.sendBatch({
        acks: -1,
        timeout: Math.max(1_000, o.timeoutMs),
        topicMessages: [...byTopic.entries()].map(([topic, list]) => ({
          topic,
          messages: list.map((m) => {
            const count = this.partitions.get(m.topic);
            if (count !== undefined) {
              return {
                key: m.key,
                value: m.value,
                headers: m.headers,
                partition: partitionForKey(m.key, count),
              };
            }
            return { key: m.key, value: m.value, headers: m.headers };
          }),
        })),
      });
      await Promise.race([
        send,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('timeout')), Math.max(1_000, o.timeoutMs));
        }),
      ]);
      return msgs.map(() => ({ kind: 'ok' as const }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'BROKER_UNAVAILABLE';
      const retryable = isRetryable(message);
      return msgs.map(() => ({
        kind: retryable ? 'retryable' : 'fatal',
        errorCode: retryable ? 'BROKER_UNAVAILABLE' : 'RECORD_INVALID',
      }));
    }
  }

  async subscribe(group: string, topics: string[], h: MessageHandler): Promise<Subscription> {
    const consumer = this.kafka().consumer({
      groupId: group,
      sessionTimeout: 15_000,
      heartbeatInterval: 3_000,
      allowAutoTopicCreation: false,
      retry: { retries: 1, initialRetryTime: 100, maxRetryTime: 1_000 },
    });
    this.consumers.push(consumer);
    await withTimeout(consumer.connect(), 10_000, 'consumer connect timeout');
    for (const topic of topics) {
      await consumer.subscribe({ topic, fromBeginning: true });
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('consumer group join timeout')), 20_000);
      let joined = false;
      consumer.on(consumer.events.GROUP_JOIN, () => {
        if (joined) return;
        joined = true;
        clearTimeout(timer);
        resolve();
      });
      void consumer
        .run({
          autoCommit: false,
          eachMessage: async ({ topic, partition, message }) => {
            const incoming: IncomingMessage = {
              topic,
              partition,
              offset: message.offset,
              key: message.key?.toString() ?? '',
              value: message.value?.toString() ?? '',
              headers: decodeHeaders(message.headers),
            };
            await h(incoming);
            await consumer.commitOffsets([
              { topic, partition, offset: (BigInt(message.offset) + 1n).toString() },
            ]);
          },
        })
        .catch((cause: unknown) => {
          if (!joined) {
            clearTimeout(timer);
            reject(cause instanceof Error ? cause : new Error(String(cause)));
          }
        });
    });
    return {
      close: async () => {
        await consumer.stop();
        await consumer.disconnect();
      },
    };
  }

  async logEndOffsets(topic: string): Promise<Map<number, bigint>> {
    const admin = await this.getAdmin();
    const listed = await admin.fetchTopicOffsets(topic);
    const map = new Map<number, bigint>();
    for (const p of listed) {
      map.set(p.partition, BigInt(p.high));
    }
    return map;
  }

  async committedOffsets(group: string, topic: string): Promise<Map<number, bigint>> {
    const admin = await this.getAdmin();
    const groups = await admin.fetchOffsets({ groupId: group, topics: [topic] });
    const map = new Map<number, bigint>();
    for (const t of groups) {
      if (t.topic !== topic) continue;
      for (const p of t.partitions) {
        const offset = BigInt(p.offset);
        map.set(p.partition, offset < 0n ? 0n : offset);
      }
    }
    return map;
  }

  async close(): Promise<void> {
    await Promise.all(
      this.consumers.map(async (c) => {
        try {
          await c.stop();
        } catch {
          // already stopped
        }
        try {
          await c.disconnect();
        } catch {
          // already disconnected
        }
      }),
    );
    this.consumers.length = 0;
    if (this.producer) {
      try {
        await this.producer.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.producer = undefined;
    if (this.admin) {
      try {
        await this.admin.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.admin = undefined;
    this.client = undefined;
  }
}
