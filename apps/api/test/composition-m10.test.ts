import { Writable } from 'node:stream';
import { createLogger } from '@serviceform/observability';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { M10PluginMounts } from '../src/composition/m10.js';

const config = loadConfig({
  SF_ENVIRONMENT: 'CI',
  SF_SERVICE_VERSION: '0.0.0-test',
  LOG_LEVEL: 'silent',
  SF_GATEWAY_RATE_LIMIT_MAX: '1000',
});

function silentLogger(lines: string[] = []) {
  const destination = new Writable({
    write(chunk: Buffer, _e, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return createLogger({ service: 'api-test', version: 'test', level: 'info', destination });
}

function m10Mounts(): M10PluginMounts {
  return {
    golden: { catalogueId: 'IND-SOC-002', policyInputRequired: true },
  };
}

describe('SF-M10-HOST composition mounts', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('admits IND-SOC-002 metadata marker when golden mount supplied', async () => {
    app = await buildApp(config, { logger: silentLogger(), m10: m10Mounts() });
    expect(app.m10Mounted).toEqual(['IND-SOC-002']);
  });

  it('leaves m10Mounted undefined when mounts are omitted', async () => {
    app = await buildApp(config, { logger: silentLogger() });
    expect(app.m10Mounted).toBeUndefined();
  });

  it('refuses golden mounts that would invent owner policy inputs', async () => {
    await expect(
      buildApp(config, {
        logger: silentLogger(),
        m10: {
          // @ts-expect-error intentional invalid host input
          golden: { catalogueId: 'IND-SOC-002', policyInputRequired: false },
        },
      }),
    ).rejects.toThrow(/policyInputRequired/);
  });

  it('refuses non-canonical catalogue markers', async () => {
    await expect(
      buildApp(config, {
        logger: silentLogger(),
        m10: { golden: { catalogueId: 'INVENTED-CATALOGUE', policyInputRequired: true } },
      }),
    ).rejects.toThrow(/catalogueId/);
  });
});
