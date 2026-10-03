import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const pool = {
    connect: vi.fn(),
    end: vi.fn(),
  };
  const transport = {
    ensureTopics: vi.fn(async () => undefined),
  };
  const publisher = {
    start: vi.fn(async () => undefined),
  };
  return { pool, transport, publisher };
});

vi.mock('pg', () => ({
  default: {
    Pool: function Pool() {
      return mocks.pool;
    },
  },
}));

vi.mock('@serviceform/outbox/kafka', () => ({
  KafkaTransport: class {
    ensureTopics = mocks.transport.ensureTopics;
  },
}));

vi.mock('@serviceform/outbox/publisher', () => ({
  createOutboxPublisher: vi.fn(() => mocks.publisher),
}));

import { startRelay } from '../../src/relay/main.js';

describe('startRelay', () => {
  beforeEach(() => {
    delete process.env['DATABASE_URL'];
    delete process.env['SF_KAFKA_BROKERS'];
  });

  it('requires DATABASE_URL and brokers', async () => {
    await expect(startRelay()).rejects.toThrow(/DATABASE_URL/);
    process.env['DATABASE_URL'] = 'postgres://x';
    await expect(startRelay()).rejects.toThrow(/SF_KAFKA_BROKERS/);
  });

  it('starts the publisher against REAL Kafka', async () => {
    process.env['DATABASE_URL'] = 'postgres://x';
    process.env['SF_KAFKA_BROKERS'] = '127.0.0.1:19092';
    process.env['SF_OUTBOX_WORKER_ID'] = 'unit-relay';
    await startRelay();
    expect(mocks.transport.ensureTopics).toHaveBeenCalled();
    expect(mocks.publisher.start).toHaveBeenCalled();
  });
});
