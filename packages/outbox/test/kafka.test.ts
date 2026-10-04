import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const producer = {
    connect: vi.fn(async () => undefined),
    sendBatch: vi.fn(async () => []),
    disconnect: vi.fn(async () => undefined),
  };
  const admin = {
    connect: vi.fn(async () => undefined),
    createTopics: vi.fn(async () => true),
    fetchTopicOffsets: vi.fn(async () => [{ partition: 0, high: '4' }]),
    fetchOffsets: vi.fn(async () => [
      {
        topic: 'sf.example.events',
        partitions: [
          { partition: 0, offset: '2' },
          { partition: 1, offset: '-1' },
        ],
      },
      { topic: 'other', partitions: [{ partition: 0, offset: '9' }] },
    ]),
    disconnect: vi.fn(async () => undefined),
  };
  const consumer = {
    connect: vi.fn(async () => undefined),
    subscribe: vi.fn(async () => undefined),
    events: { GROUP_JOIN: 'consumer.group_join' },
    on: vi.fn((_event: string, cb: () => void) => {
      cb();
    }),
    run: vi.fn(),
    commitOffsets: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  };
  return { producer, admin, consumer };
});

vi.mock('kafkajs', () => ({
  Kafka: class {
    producer() {
      return mocks.producer;
    }
    admin() {
      return mocks.admin;
    }
    consumer() {
      return mocks.consumer;
    }
  },
  logLevel: { NOTHING: 0 },
}));

import { KafkaTransport } from '../src/transport/kafka.js';

interface EachPayload {
  topic: string;
  partition: number;
  message: {
    offset: string;
    key: Buffer | null;
    value: Buffer | null;
    headers?: Record<string, unknown>;
  };
}

describe('KafkaTransport', () => {
  beforeEach(() => {
    mocks.producer.connect.mockReset();
    mocks.producer.sendBatch.mockReset();
    mocks.producer.disconnect.mockReset();
    mocks.admin.connect.mockReset();
    mocks.admin.createTopics.mockReset();
    mocks.admin.fetchTopicOffsets.mockReset();
    mocks.admin.fetchOffsets.mockReset();
    mocks.admin.disconnect.mockReset();
    mocks.consumer.connect.mockReset();
    mocks.consumer.subscribe.mockReset();
    mocks.consumer.on.mockReset();
    mocks.consumer.run.mockReset();
    mocks.consumer.commitOffsets.mockReset();
    mocks.consumer.stop.mockReset();
    mocks.consumer.disconnect.mockReset();
    mocks.producer.connect.mockResolvedValue(undefined);
    mocks.producer.sendBatch.mockResolvedValue([]);
    mocks.producer.disconnect.mockResolvedValue(undefined);
    mocks.admin.connect.mockResolvedValue(undefined);
    mocks.admin.createTopics.mockResolvedValue(true);
    mocks.admin.fetchTopicOffsets.mockResolvedValue([{ partition: 0, high: '4' }]);
    mocks.admin.fetchOffsets.mockResolvedValue([
      {
        topic: 'sf.example.events',
        partitions: [
          { partition: 0, offset: '2' },
          { partition: 1, offset: '-1' },
        ],
      },
      { topic: 'other', partitions: [{ partition: 0, offset: '9' }] },
    ]);
    mocks.admin.disconnect.mockResolvedValue(undefined);
    mocks.consumer.connect.mockResolvedValue(undefined);
    mocks.consumer.subscribe.mockResolvedValue(undefined);
    mocks.consumer.on.mockImplementation((_event: string, cb: () => void) => {
      cb();
    });
    mocks.consumer.run.mockResolvedValue(undefined);
    mocks.consumer.commitOffsets.mockResolvedValue(undefined);
    mocks.consumer.stop.mockResolvedValue(undefined);
    mocks.consumer.disconnect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates topics, publishes with and without known partitions, and reads offsets', async () => {
    const t = new KafkaTransport({ brokers: ['127.0.0.1:19092'] });
    expect(t.mode).toBe('REAL');
    expect(await t.publish([], { timeoutMs: 10 })).toEqual([]);
    await t.ensureTopics([{ topic: 'sf.example.events', partitions: 6, replicationFactor: 1 }]);
    mocks.admin.createTopics.mockRejectedValueOnce(new Error('Topic already exists'));
    await t.ensureTopics([{ topic: 'sf.example.events', partitions: 6, replicationFactor: 1 }]);
    const ok = await t.publish(
      [
        { topic: 'sf.example.events', key: 'k', value: '{}', headers: { a: 'b' } },
        { topic: 'other', key: 'k2', value: '{}', headers: {} },
      ],
      { timeoutMs: 50 },
    );
    expect(ok.every((r) => r.kind === 'ok')).toBe(true);
    expect(mocks.producer.connect).toHaveBeenCalledTimes(1);
    const again = await t.publish(
      [{ topic: 'sf.example.events', key: 'k3', value: '{}', headers: {} }],
      { timeoutMs: 50 },
    );
    expect(again[0]?.kind).toBe('ok');
    expect(mocks.producer.connect).toHaveBeenCalledTimes(1);
    const ends = await t.logEndOffsets('sf.example.events');
    expect(ends.get(0)).toBe(4n);
    const committed = await t.committedOffsets('g', 'sf.example.events');
    expect(committed.get(0)).toBe(2n);
    expect(committed.get(1)).toBe(0n);
    mocks.admin.disconnect.mockRejectedValueOnce(new Error('gone'));
    mocks.producer.disconnect.mockRejectedValueOnce(new Error('gone'));
    await t.close();
  });

  it('maps retryable and fatal publish errors', async () => {
    const t = new KafkaTransport({ brokers: ['127.0.0.1:19092'], clientId: 'unit' });
    mocks.producer.sendBatch.mockRejectedValueOnce(new Error('ECONNREFUSED broker unavailable'));
    const retry = await t.publish([{ topic: 't', key: 'k', value: '{}', headers: {} }], {
      timeoutMs: 20,
    });
    expect(retry[0]?.kind).toBe('retryable');
    expect(retry[0]?.errorCode).toBe('BROKER_UNAVAILABLE');
    mocks.producer.sendBatch.mockRejectedValueOnce(new Error('invalid record'));
    const fatal = await t.publish([{ topic: 't', key: 'k', value: '{}', headers: {} }], {
      timeoutMs: 20,
    });
    expect(fatal[0]?.kind).toBe('fatal');
    expect(fatal[0]?.errorCode).toBe('RECORD_INVALID');
    mocks.producer.sendBatch.mockRejectedValueOnce('nope');
    const nonError = await t.publish([{ topic: 't', key: 'k', value: '{}', headers: {} }], {
      timeoutMs: 20,
    });
    expect(nonError[0]?.kind).toBe('retryable');
    await t.close();
  });

  it('maps producer connect timeout and send timeout as retryable', async () => {
    vi.useFakeTimers();
    const t = new KafkaTransport({ brokers: ['127.0.0.1:1'] });
    mocks.producer.connect.mockImplementation(() => new Promise(() => undefined));
    const connectP = t.publish([{ topic: 't', key: 'k', value: '{}', headers: {} }], {
      timeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(8_000);
    const connectOut = await connectP;
    expect(connectOut[0]?.kind).toBe('retryable');

    mocks.producer.connect.mockResolvedValue(undefined);
    mocks.producer.sendBatch.mockImplementation(() => new Promise(() => undefined));
    const sendP = t.publish([{ topic: 't', key: 'k', value: '{}', headers: {} }], {
      timeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const sendOut = await sendP;
    expect(sendOut[0]?.kind).toBe('retryable');
    await t.close();
  });

  it('subscribes, decodes headers, commits offsets, and ignores already-stopped consumers', async () => {
    let each: ((args: EachPayload) => Promise<void>) | undefined;
    mocks.consumer.on.mockImplementation((_event: string, cb: () => void) => {
      cb();
      cb();
    });
    mocks.consumer.run.mockImplementation(async (opts: { eachMessage: typeof each }) => {
      each = opts.eachMessage;
    });
    const t = new KafkaTransport({ brokers: ['127.0.0.1:1'] });
    const seen: string[] = [];
    const sub = await t.subscribe('grp', ['sf.example.events'], async (m) => {
      seen.push(`${m.key}:${m.value}:${m.headers['a']}${m.headers['b']}${m.headers['c']}`);
    });
    if (!each) throw new Error('eachMessage not captured');
    await each({
      topic: 'sf.example.events',
      partition: 0,
      message: {
        offset: '3',
        key: Buffer.from('k'),
        value: Buffer.from('v'),
        headers: {
          a: Buffer.from('x'),
          b: 'y',
          c: [Buffer.from('p'), 'q'],
          d: undefined,
        },
      },
    });
    await each({
      topic: 'sf.example.events',
      partition: 0,
      message: { offset: '4', key: null, value: null },
    });
    expect(seen[0]).toContain('k:v:xy');
    expect(mocks.consumer.commitOffsets).toHaveBeenCalled();
    await sub.close();
    mocks.consumer.stop.mockRejectedValueOnce(new Error('stopped'));
    mocks.consumer.disconnect.mockRejectedValueOnce(new Error('disconnected'));
    await t.close();
  });

  it('rejects subscribe when the consumer cannot join the group', async () => {
    mocks.consumer.on.mockImplementation(() => undefined);
    mocks.consumer.run.mockImplementation(async () => {
      throw new Error('coordinator down');
    });
    const t = new KafkaTransport({ brokers: ['127.0.0.1:1'] });
    await expect(t.subscribe('grp', ['t'], async () => undefined)).rejects.toThrow(
      /coordinator down/,
    );
    mocks.consumer.run.mockImplementation(async () => {
      throw 'raw-fail';
    });
    await expect(t.subscribe('grp', ['t'], async () => undefined)).rejects.toThrow(/raw-fail/);
    await t.close();
  });

  it('times out when GROUP_JOIN never fires', async () => {
    vi.useFakeTimers();
    mocks.consumer.on.mockImplementation(() => undefined);
    mocks.consumer.run.mockImplementation(() => new Promise(() => undefined));
    const t = new KafkaTransport({ brokers: ['127.0.0.1:1'] });
    const p = t.subscribe('grp', ['t'], async () => undefined);
    const expectation = expect(p).rejects.toThrow(/consumer group join timeout/);
    await vi.advanceTimersByTimeAsync(20_000);
    await expectation;
    await t.close();
  });

  it('rethrows topic-create errors that are not already-exists', async () => {
    const t = new KafkaTransport({ brokers: ['127.0.0.1:1'] });
    mocks.admin.createTopics.mockRejectedValueOnce(new Error('not authorized'));
    await expect(
      t.ensureTopics([{ topic: 't', partitions: 1, replicationFactor: 1 }]),
    ).rejects.toThrow(/not authorized/);
    mocks.admin.createTopics.mockRejectedValueOnce('exist');
    await t.ensureTopics([{ topic: 't', partitions: 1, replicationFactor: 1 }]);
    await t.close();
  });
});
