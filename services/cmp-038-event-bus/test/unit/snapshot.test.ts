import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('registry snapshot (Q2 / 004-27)', () => {
  it('packages/outbox snapshot matches services/cmp-038-event-bus/registry/topics.json', () => {
    const snap = JSON.parse(
      readFileSync(join(root, 'packages/outbox/src/registry-snapshot.json'), 'utf8'),
    );
    const topics = JSON.parse(
      readFileSync(join(root, 'services/cmp-038-event-bus/registry/topics.json'), 'utf8'),
    );
    expect(snap).toEqual(topics);
  });
});
