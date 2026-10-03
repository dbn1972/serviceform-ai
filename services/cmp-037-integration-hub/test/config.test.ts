import { describe, expect, it } from 'vitest';
import { loadHubConfig } from '../src/config.js';
import { ProductionSimulatedCriticalConnectorError } from '@serviceform/connector-sdk';

describe('hub config fail-closed (005-18)', () => {
  it('refuses unset, empty, lowercase and unknown SF_ENVIRONMENT', () => {
    expect(() => loadHubConfig({})).toThrow(ProductionSimulatedCriticalConnectorError);
    expect(() => loadHubConfig({ SF_ENVIRONMENT: '', SF_CELL_ID: 'cell-01' })).toThrow();
    expect(() => loadHubConfig({ SF_ENVIRONMENT: 'production', SF_CELL_ID: 'cell-01' })).toThrow();
    expect(() => loadHubConfig({ SF_ENVIRONMENT: 'CI' })).toThrow(/SF_CELL_ID/);
    expect(loadHubConfig({ SF_ENVIRONMENT: 'CI', SF_CELL_ID: 'cell-01' }).environment).toBe('CI');
  });
});
