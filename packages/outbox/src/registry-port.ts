export type TopicTenancy = 'TENANT_SCOPED' | 'PLATFORM_OPERATIONAL';
export type PartitionKeyStrategy = 'AGGREGATE_ID' | 'DECLARED';
export type Compatibility = 'BACKWARD' | 'FORWARD' | 'FULL';

export interface RegisteredSchema {
  event_type: string;
  schema_version: number;
  data_schema: Record<string, unknown>;
}

export interface TopicSpec {
  topic_name: string;
  owner_component: string;
  tenancy: TopicTenancy;
  partition_key_strategy: PartitionKeyStrategy;
  partitions: number;
  replication_factor: number;
  broker_retention: string;
  outbox_retention: string;
  replay_class: string;
  compatibility: Compatibility;
  dlq_topic: string;
  status: 'ACTIVE' | 'DEPRECATED';
  schemas: RegisteredSchema[];
}

export interface TopicRegistryReader {
  getTopic(name: string): TopicSpec | undefined;
  allTopics(): readonly TopicSpec[];
  retentionFor(topic: string): string | undefined;
}

export function intervalToMs(value: string): number {
  const trimmed = value.trim();
  const match = /^(\d+)\s*(ms|s|m|h|d|days?|hours?|minutes?|seconds?)$/i.exec(trimmed);
  if (!match?.[1] || !match[2]) {
    const pg = /^(\d+)\s+days?$/i.exec(trimmed);
    if (pg?.[1]) return Number(pg[1]) * 86_400_000;
    return 7 * 86_400_000;
  }
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'ms') return n;
  if (unit === 's' || unit.startsWith('second')) return n * 1000;
  if (unit === 'm' || unit.startsWith('minute')) return n * 60_000;
  if (unit === 'h' || unit.startsWith('hour')) return n * 3_600_000;
  return n * 86_400_000;
}
