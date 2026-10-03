const SCHEMA_NAME = /^[a-z][a-z0-9_]{0,62}$/;
const TOPIC_NAME = /^[a-zA-Z0-9._-]{3,249}$/;
const EVENT_TYPE = /^[A-Z][A-Za-z0-9]{2,79}$/;
const CONSUMER_GROUP = /^[a-z0-9][a-z0-9._-]{0,99}$/;

export function assertSchemaName(value: string): string {
  if (
    !SCHEMA_NAME.test(value) ||
    value.startsWith('pg_') ||
    value === 'information_schema' ||
    value === 'public'
  ) {
    throw new Error(`invalid schema identifier: rejected before SQL`);
  }
  return value;
}

export function assertTopicName(value: string): string {
  if (!TOPIC_NAME.test(value)) {
    throw new Error(`invalid topic name`);
  }
  return value;
}

export function assertEventType(value: string): string {
  if (!EVENT_TYPE.test(value)) {
    throw new Error(`invalid event type`);
  }
  return value;
}

export function assertConsumerGroup(value: string): string {
  if (!CONSUMER_GROUP.test(value)) {
    throw new Error(`invalid consumer group`);
  }
  return value;
}

/** Producer-facing: allowlisted unquoted identifier, then quoted. */
export function quoteIdent(value: string): string {
  assertSchemaName(value);
  return quoteIdentRaw(value);
}

/** Catalog-facing: quote any PostgreSQL identifier (004-07 oddly named schemas). */
export function quoteIdentRaw(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export { SCHEMA_NAME, TOPIC_NAME, EVENT_TYPE, CONSUMER_GROUP };
