import { describe, expect, it } from 'vitest';
import { nextStatus } from '../../src/domain/model.js';

describe('deficiency status table', () => {
  it('allows citizen response and officer close from OPEN, and close from RESPONSE_RECEIVED', () => {
    expect(nextStatus('OPEN', 'RESPOND')).toBe('RESPONSE_RECEIVED');
    expect(nextStatus('OPEN', 'CLOSE')).toBe('CLOSED');
    expect(nextStatus('RESPONSE_RECEIVED', 'CLOSE')).toBe('CLOSED');
    expect(nextStatus('CLOSED', 'RESPOND')).toBeNull();
    expect(nextStatus('RESPONSE_RECEIVED', 'RESPOND')).toBeNull();
  });
});
