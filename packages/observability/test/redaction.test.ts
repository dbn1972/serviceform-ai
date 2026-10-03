import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { REDACTED, createLogger, isSensitiveKey, redactDeep } from '../src/index.js';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, stream };
}

describe('PII and secret redaction (REQ: Constitution #21, AWS v1.7 s5)', () => {
  it('recognises snake_case, camelCase and header-style sensitive keys', () => {
    for (const k of [
      'aadhaar_number',
      'aadhaarNumber',
      'Authorization',
      'mobileNumber',
      'set-cookie',
      'otp',
    ]) {
      expect(isSensitiveKey(k)).toBe(true);
    }
    for (const k of ['tenant_id', 'correlation_id', 'status', 'service_id'])
      expect(isSensitiveKey(k)).toBe(false);
  });

  it('redacts sensitive values at any depth and keeps safe fields', () => {
    const input = {
      tenant_id: 't1',
      applicant: {
        full_name: 'Synthetic Person',
        contact: { mobile: '9000000000', email: 'x@example.test' },
      },
      list: [{ otp: '123456', ok: 1 }],
    };
    const out = redactDeep(input);
    expect(out.tenant_id).toBe('t1');
    expect(out.applicant.full_name).toBe(REDACTED);
    expect(out.applicant.contact.mobile).toBe(REDACTED);
    expect(out.list[0]?.otp).toBe(REDACTED);
    expect(out.list[0]?.ok).toBe(1);
    expect(input.applicant.full_name).toBe('Synthetic Person');
  });

  it('logger never writes sensitive values', () => {
    const { lines, stream } = capture();
    const log = createLogger({ service: 'test', version: '0.0.0', destination: stream });
    log.info(
      {
        password: 'p',
        user: { aadhaar: '000000000000', profile: { phone: '9000000000' } },
        req: { headers: { authorization: 'Bearer abc' } },
      },
      'event',
    );
    const text = lines.join('');
    expect(text).not.toContain('000000000000');
    expect(text).not.toContain('9000000000');
    expect(text).not.toContain('Bearer abc');
    expect(text).toContain(REDACTED);
    const record = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(record['service']).toBe('test');
    expect(record['message']).toBe('event');
  });
});
