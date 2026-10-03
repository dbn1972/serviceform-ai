import { describe, expect, it } from 'vitest';
import { intervalToMs, RegistryError, snapshotRegistry } from '../src/index.js';

describe('intervalToMs and snapshot registry', () => {
  it('parses duration units and falls back to seven days', () => {
    expect(intervalToMs('10ms')).toBe(10);
    expect(intervalToMs('2s')).toBe(2000);
    expect(intervalToMs('3 seconds')).toBe(3000);
    expect(intervalToMs('4m')).toBe(240_000);
    expect(intervalToMs('5 minutes')).toBe(300_000);
    expect(intervalToMs('6h')).toBe(21_600_000);
    expect(intervalToMs('1 hour')).toBe(3_600_000);
    expect(intervalToMs('2d')).toBe(172_800_000);
    expect(intervalToMs('3 days')).toBe(259_200_000);
    expect(intervalToMs('9 days')).toBe(777_600_000);
    expect(intervalToMs('not-a-duration')).toBe(7 * 86_400_000);
  });

  it('reads shipped snapshot topics', () => {
    const r = snapshotRegistry();
    expect(r.getTopic('missing')).toBeUndefined();
    expect(r.retentionFor('missing')).toBeUndefined();
    const example = r.getTopic('sf.example.events');
    expect(example?.tenancy).toBe('TENANT_SCOPED');
    expect(r.retentionFor('sf.example.events')).toBe('7 days');
    expect(r.allTopics().length).toBeGreaterThanOrEqual(3);
  });

  it('RegistryError keeps the catalogue code', () => {
    const err = new RegistryError('SF-SYS-003', {
      details: [{ code: 'SCHEMA_INCOMPATIBLE' }],
      message: 'nope',
    });
    expect(err.name).toBe('RegistryError');
    expect(err.code).toBe('SF-SYS-003');
  });
});
