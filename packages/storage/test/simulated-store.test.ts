import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/checksum.js';
import { SimulatedObjectStore } from '../src/simulated-store.js';
import { buildStorageSimulationMarker } from '../src/simulation-marker.js';
import { createSimulatedPresign, verifySimulatedPresign } from '../src/presign.js';
import { StoragePortError } from '../src/errors.js';

const BINDING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('SimulatedObjectStore + presign', () => {
  it('puts, archives, and requires simulation marker', async () => {
    const store = new SimulatedObjectStore();
    const bytes = new TextEncoder().encode('payload');
    const checksum = sha256Hex(bytes);
    const marker = buildStorageSimulationMarker({
      environment: 'CI',
      scenario: 'store_success',
      testRunId: 't1',
      storageBindingId: BINDING,
    });
    await expect(
      store.put({
        objectId: '11111111-1111-4111-8111-111111111111',
        objectKey: 't/x/c/cell-01/o/y/abcdef',
        contentType: 'application/octet-stream',
        bytes,
        checksumSha256: checksum,
        mode: 'SIMULATED',
      }),
    ).rejects.toBeInstanceOf(StoragePortError);

    await store.put({
      objectId: '11111111-1111-4111-8111-111111111111',
      objectKey: 't/x/c/cell-01/o/y/abcdef',
      contentType: 'application/octet-stream',
      bytes,
      checksumSha256: checksum,
      mode: 'SIMULATED',
      simulation: marker,
    });
    await store.archive('11111111-1111-4111-8111-111111111111');
    const got = await store.getBytes('11111111-1111-4111-8111-111111111111');
    expect(got?.checksumSha256).toBe(checksum);
  });

  it('presign fails closed when secret port fails', async () => {
    await expect(
      createSimulatedPresign({
        secrets: {
          getHmacKey: async () => {
            throw new Error('down');
          },
        },
        secretName: 'storage-presign',
        objectId: '11111111-1111-4111-8111-111111111111',
        objectKey: 'k',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toBeInstanceOf(StoragePortError);
  });

  it('verifies simulated presign tokens', async () => {
    const key = new TextEncoder().encode('0123456789abcdef0123456789abcdef');
    const secrets = { getHmacKey: async () => key };
    const access = await createSimulatedPresign({
      secrets,
      secretName: 'storage-presign',
      objectId: '11111111-1111-4111-8111-111111111111',
      objectKey: 'k',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const url = new URL(access.url.replace('sim://', 'http://'));
    const ok = await verifySimulatedPresign({
      secrets,
      secretName: 'storage-presign',
      objectId: '11111111-1111-4111-8111-111111111111',
      objectKey: 'k',
      exp: Number(url.searchParams.get('exp')),
      sig: String(url.searchParams.get('sig')),
    });
    expect(ok).toBe(true);
  });
});
