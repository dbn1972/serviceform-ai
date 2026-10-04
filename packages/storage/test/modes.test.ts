import { describe, expect, it } from 'vitest';
import { assertStorageModeAllowed, parseDeploymentEnvironment } from '../src/modes.js';
import { StoragePortError } from '../src/errors.js';

describe('modes', () => {
  it('allows SIMULATED in LOCAL', () => {
    expect(() => assertStorageModeAllowed('SIMULATED', 'LOCAL')).not.toThrow();
    expect(() => assertStorageModeAllowed('LOCAL', 'LOCAL')).not.toThrow();
  });

  it('refuses REAL without ADR', () => {
    expect(() => assertStorageModeAllowed('REAL', 'LOCAL')).toThrow(StoragePortError);
  });

  it('refuses SIMULATED in PRODUCTION', () => {
    expect(() => assertStorageModeAllowed('SIMULATED', 'PRODUCTION')).toThrow(StoragePortError);
  });

  it('parses environment', () => {
    expect(parseDeploymentEnvironment('CI')).toBe('CI');
    expect(() => parseDeploymentEnvironment(undefined)).toThrow(StoragePortError);
  });
});
