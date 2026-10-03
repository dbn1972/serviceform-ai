import { describe, expect, it } from 'vitest';
import { startTelemetry } from '../src/index.js';

describe('telemetry bootstrap (REQ: AWS v1.7 s3 OpenTelemetry; s5 SLO/dashboards)', () => {
  it('stays off when no OTLP endpoint is configured', async () => {
    const t = startTelemetry({ serviceName: 's', serviceVersion: '0', environment: 'CI' });
    expect(t.enabled).toBe(false);
    await t.shutdown();
  });

  it('stays off when OTEL_SDK_DISABLED is true', async () => {
    process.env['OTEL_SDK_DISABLED'] = 'true';
    try {
      const t = startTelemetry({
        serviceName: 's',
        serviceVersion: '0',
        environment: 'CI',
        otlpEndpoint: 'http://127.0.0.1:9',
      });
      expect(t.enabled).toBe(false);
    } finally {
      delete process.env['OTEL_SDK_DISABLED'];
    }
  });

  it('starts and shuts down cleanly with an endpoint', async () => {
    const t = startTelemetry({
      serviceName: 's',
      serviceVersion: '0',
      environment: 'CI',
      otlpEndpoint: 'http://127.0.0.1:9/',
    });
    expect(t.enabled).toBe(true);
    await expect(t.shutdown()).resolves.toBeUndefined();
  });
});
