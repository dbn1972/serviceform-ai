import { describe, expect, it } from 'vitest';
import { createInt002Client } from '../../../services/cmp-050-studio-portal/src/int002-client.js';
import {
  assertPlatformPath,
  type PlatformTransport,
} from '../../../services/cmp-050-studio-portal/src/proxy.js';

describe('INT-002 Studio client (independent; CMP-050)', () => {
  it('allowlists only /v1 platform paths', () => {
    expect(assertPlatformPath('v1/metadata/documents')).toBe('/v1/metadata/documents');
    expect(assertPlatformPath('tenant-service-bindings')).toBe('/v1/tenant-service-bindings');
    expect(assertPlatformPath('publication-requests')).toBe('/v1/publication-requests');
    expect(() => assertPlatformPath('internal/admin')).toThrow();
  });

  it('approve/reject HTTP bodies omit required CMP-051 decision reason (seam residual)', async () => {
    const captured: Array<{ path: string; body: unknown }> = [];
    const transport: PlatformTransport = {
      async send(req) {
        captured.push({ path: req.path, body: req.body });
        return { status: 200, body: { status: 'ok' } };
      },
    };
    const client = createInt002Client(transport);
    await client.approvePublicationRequest('f0000000-0000-4000-8000-000000000001');
    await client.rejectPublicationRequest('f0000000-0000-4000-8000-000000000001');
    const approve = captured.find((c) => c.path.endsWith('/approve'));
    const reject = captured.find((c) => c.path.endsWith('/reject'));
    expect(approve).toBeDefined();
    expect(reject).toBeDefined();
    expect(approve?.body).toBeUndefined();
    expect(reject?.body).toBeUndefined();
  });
});
