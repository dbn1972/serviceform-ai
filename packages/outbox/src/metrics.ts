import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('@serviceform/outbox');

export const claimed = meter.createCounter('sf.outbox.claimed', {
  description: 'Outbox rows claimed for publish',
});
export const published = meter.createCounter('sf.outbox.published', {
  description: 'Outbox rows marked PUBLISHED',
});
export const publishFailures = meter.createCounter('sf.outbox.publish_failures', {
  description: 'Publish attempts that failed',
});
export const deadLettered = meter.createCounter('sf.outbox.dead_lettered', {
  description: 'Rows moved to dead letter',
});
export const inboxDuplicates = meter.createCounter('sf.inbox.duplicates', {
  description: 'Inbox conflict skips',
});
export const publishLatency = meter.createHistogram('sf.outbox.publish_latency_ms', {
  unit: 'ms',
  description: 'Time from claim to mark',
});
export const consumerLag = meter.createGauge('sf.eventbus.consumer.lag', {
  description: 'Consumer lag by topic and partition',
});
export const committedOffset = meter.createGauge('sf.eventbus.consumer.committed_offset', {
  description: 'Committed consumer offset',
});

export const ATTR_SAFE = {
  schema: 'sf.outbox.schema',
  table: 'sf.outbox.table',
  topic: 'sf.eventbus.topic',
  consumerGroup: 'sf.eventbus.consumer_group',
  partition: 'sf.eventbus.partition',
  errorCode: 'sf.outbox.error_code',
} as const;
