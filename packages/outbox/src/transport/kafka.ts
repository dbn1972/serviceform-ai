import {
  Admin,
  Consumer,
  Producer,
  stringDeserializers,
  stringSerializers,
} from '@platformatic/kafka';
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

export class KafkaTransport implements EventTransport {
  readonly mode = 'REAL' as const;
  private readonly brokers: string[];
  private readonly clientId: string;
  private producer: Producer<string, string, string, string> | undefined;
  private admin: Admin | undefined;
  private readonly partitions = new Map<string, number>();
  private readonly consumers: Consumer<string, string, string, string>[] = [];

  constructor(options: KafkaTransportOptions) {
    this.brokers = options.brokers;
    this.clientId = options.clientId ?? 'sf-cmp038';
  }

  private async getProducer(): Promise<Producer<string, string, string, string>> {
    if (!this.producer) {
      this.producer = new Producer({
        clientId: this.clientId + '-producer',
        bootstrapBrokers: this.brokers,
        serializers: stringSerializers,
        idempotent: true,
        acks: -1,
        autocreateTopics: false,
      });
    }
    return this.producer;
  }

  private async getAdmin(): Promise<Admin> {
    if (!this.admin) {
      this.admin = new Admin({
        clientId: this.clientId + '-admin',
        bootstrapBrokers: this.brokers,
      });
    }
    return this.admin;
  }

  async ensureTopics(defs: TopicCreateSpec[]): Promise<void> {
    const admin = await this.getAdmin();
    try {
      await admin.createTopics({
        topics: defs.map((d) => ({
          topic: d.topic,
          partitions: d.partitions,
          replicas: d.replicationFactor,
        })),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!/already|exist/i.test(message)) throw cause;
    }
    for (const d of defs) this.partitions.set(d.topic, d.partitions);
  }

  async publish(msgs: OutgoingMessage[], o: { timeoutMs: number }): Promise<PublishOutcome[]> {
    try {
      const producer = await this.getProducer();
      await producer.send({
        messages: msgs.map((m) => {
          const count = this.partitions.get(m.topic);
          if (count !== undefined) {
            return {
              topic: m.topic,
              key: m.key,
              value: m.value,
              headers: m.headers,
              partition: partitionForKey(m.key, count),
            };
          }
          return { topic: m.topic, key: m.key, value: m.value, headers: m.headers };
        }),
        acks: -1,
        idempotent: true,
      });
      void o;
      return msgs.map(() => ({ kind: 'ok' as const }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'BROKER_UNAVAILABLE';
      const retryable = /timeout|unavailable|network|not.?leader|unknown.?topic|connection/i.test(
        message,
      );
      return msgs.map(() => ({
        kind: retryable ? 'retryable' : 'fatal',
        errorCode: retryable ? 'BROKER_UNAVAILABLE' : 'RECORD_INVALID',
      }));
    }
  }

  async subscribe(group: string, topics: string[], h: MessageHandler): Promise<Subscription> {
    const consumer = new Consumer({
      groupId: group,
      clientId: this.clientId + '-consumer-' + group,
      bootstrapBrokers: this.brokers,
      deserializers: stringDeserializers,
    });
    this.consumers.push(consumer);
    const stream = await consumer.consume({
      topics,
      autocommit: false,
      sessionTimeout: 15_000,
      heartbeatInterval: 3_000,
    });
    const loop = (async () => {
      for await (const message of stream) {
        const headers: Record<string, string> = {};
        for (const [k, v] of message.headers) {
          headers[String(k)] = String(v);
        }
        const incoming: IncomingMessage = {
          topic: message.topic,
          partition: message.partition,
          offset: message.offset.toString(),
          key: message.key ?? '',
          value: message.value ?? '',
          headers,
        };
        await h(incoming);
        await message.commit();
      }
    })();
    void loop.catch(() => undefined);
    return {
      close: async () => {
        await consumer.close(true);
      },
    };
  }

  async logEndOffsets(topic: string): Promise<Map<number, bigint>> {
    const admin = await this.getAdmin();
    const count = this.partitions.get(topic) ?? 1;
    const listed = await admin.listOffsets({
      topics: [
        {
          name: topic,
          partitions: Array.from({ length: count }, (_, i) => ({
            partitionIndex: i,
            timestamp: -1n,
          })),
        },
      ],
    });
    const map = new Map<number, bigint>();
    for (const t of listed) {
      for (const p of t.partitions) map.set(p.partitionIndex, p.offset);
    }
    return map;
  }

  async committedOffsets(group: string, topic: string): Promise<Map<number, bigint>> {
    const admin = await this.getAdmin();
    const groups = await admin.listConsumerGroupOffsets({ groups: [group] });
    const map = new Map<number, bigint>();
    for (const g of groups) {
      for (const t of g.topics) {
        if (t.name !== topic) continue;
        for (const p of t.partitions) map.set(p.partitionIndex, p.committedOffset);
      }
    }
    return map;
  }

  async close(): Promise<void> {
    await Promise.all(this.consumers.map(async (c) => c.close()));
    this.consumers.length = 0;
    if (this.producer) await this.producer.close();
    this.producer = undefined;
    if (this.admin) await this.admin.close();
    this.admin = undefined;
  }
}
