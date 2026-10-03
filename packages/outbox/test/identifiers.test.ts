import { describe, expect, it } from 'vitest';
import {
  assertConsumerGroup,
  assertEventType,
  assertSchemaName,
  assertTopicName,
  quoteIdent,
  quoteIdentRaw,
} from '../src/identifiers.js';

describe('identifiers (U4, 004-09)', () => {
  it('accepts a plain schema name and quotes it', () => {
    expect(quoteIdent('sf_event_bus')).toBe('"sf_event_bus"');
  });

  it('rejects identifier injection before SQL', () => {
    for (const bad of [
      'sf_t004_a; DROP',
      '"sf_t004_a"',
      'sf_t004_a.outbox_event--',
      'pg_catalog',
      'information_schema',
      'public',
      'a'.repeat(64),
      'SF_EVENT_BUS',
    ]) {
      expect(() => assertSchemaName(bad)).toThrow(/invalid schema identifier/);
    }
  });

  it('rejects bad topics', () => {
    expect(() => assertTopicName('../x')).toThrow();
    expect(() => assertTopicName('')).toThrow();
    expect(() => assertTopicName('x'.repeat(250))).toThrow();
    expect(assertTopicName('sf.example.events')).toBe('sf.example.events');
  });

  it('quotes catalog names that contain quotes (004-07)', () => {
    expect(quoteIdentRaw('x"; DROP TABLE sf_t004_a.orders; --')).toBe(
      '"x""; DROP TABLE sf_t004_a.orders; --"',
    );
    expect(quoteIdentRaw("a'b")).toBe('"a\'b"');
  });

  it('validates event types and consumer groups', () => {
    expect(assertEventType('ExampleAggregateCreated')).toBe('ExampleAggregateCreated');
    expect(() => assertEventType('lowercase')).toThrow(/invalid event type/);
    expect(() => assertEventType('ab')).toThrow(/invalid event type/);
    expect(assertConsumerGroup('cmp038-sec')).toBe('cmp038-sec');
    expect(() => assertConsumerGroup('Bad Group')).toThrow(/invalid consumer group/);
    expect(() => assertConsumerGroup('')).toThrow(/invalid consumer group/);
  });
});
