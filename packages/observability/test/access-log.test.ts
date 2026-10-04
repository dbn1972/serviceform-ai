import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, sanitizeRequestForLog, sanitizeUrlForLog } from '../src/index.js';

describe('access-log URL sanitisation (REQ: G-10, Constitution #21)', () => {
  it('strips query strings and fragments from URLs', () => {
    expect(sanitizeUrlForLog('/v1/audit?from=2026-01-01&email=a%40b.test')).toBe('/v1/audit');
    expect(sanitizeUrlForLog('/v1/meta#section')).toBe('/v1/meta');
    expect(sanitizeUrlForLog('/v1/x?a=1#b')).toBe('/v1/x');
    expect(sanitizeUrlForLog('')).toBe('/');
  });

  it('serialises only method, path and id', () => {
    expect(
      sanitizeRequestForLog({
        id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
        method: 'GET',
        url: '/v1/tenants/x?mobile=9000000000',
      }),
    ).toEqual({
      id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
      method: 'GET',
      url: '/v1/tenants/x',
    });
  });

  it('logger never writes query-string values from req.url', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const log = createLogger({ service: 'test', version: '0.0.0', destination: stream });
    log.info(
      { req: { method: 'GET', url: '/v1/audit?aadhaar=999999999999&token=secret' } },
      'incoming request',
    );
    const text = lines.join('');
    expect(text).toContain('/v1/audit');
    expect(text).not.toContain('aadhaar');
    expect(text).not.toContain('999999999999');
    expect(text).not.toContain('token=secret');
    expect(text).not.toContain('?');
  });
});
