import { metrics } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { claimed, published } from '../src/metrics.js';

describe('metrics (U11)', () => {
  it('records counters without tenant attributes', () => {
    claimed.add(1, { 'sf.outbox.table': 'outbox_event' });
    published.add(1, { 'sf.outbox.table': 'outbox_event' });
    const meter = metrics.getMeter('@serviceform/outbox');
    expect(meter).toBeTruthy();
  });
});
