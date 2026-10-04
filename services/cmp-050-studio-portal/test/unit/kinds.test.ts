import { describe, expect, it } from 'vitest';
import {
  METADATA_KINDS,
  defaultFieldValues,
  isMetadataKind,
  payloadFromFields,
} from '../../src/metadata-kinds.js';

describe('metadata kind catalog', () => {
  it('covers every generic kind with a default payload shape', () => {
    expect(METADATA_KINDS).toHaveLength(11);
    for (const kind of METADATA_KINDS) {
      expect(isMetadataKind(kind)).toBe(true);
      const payload = payloadFromFields(kind, defaultFieldValues(kind));
      expect(payload).toBeTypeOf('object');
    }
  });

  it('does not special-case a named citizen service', () => {
    const src = METADATA_KINDS.join(',');
    expect(src.toLowerCase()).not.toContain('residence');
    expect(src.toLowerCase()).not.toContain('income');
  });
});
