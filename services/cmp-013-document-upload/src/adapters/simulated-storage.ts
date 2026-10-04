import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SimulationMarker } from '@serviceform/contracts';
import {
  buildStorageSimulationMarker,
  createSimulatedPresign,
  sha256Hex,
  SimulatedObjectStore,
  StoragePortError,
  type StorageSecretsPort,
} from '@serviceform/storage';
import { SNIFF_HEAD_BYTES } from '../domain/content-type.js';
import { isKeyOwnedByTenant } from '../domain/object-key.js';
import type {
  DocumentStoragePort,
  DownloadAccess,
  ObjectInspection,
  UploadTarget,
} from '../ports/storage-port.js';

const UPLOAD_SCHEME = 'sim://upload/';

export interface SimulatedDocumentStorageOptions {
  environment: string;
  testRunId: string;
  connectorBindingId: string;
  secrets: StorageSecretsPort;
  secretName: string;
  scenario?: string;
  store?: SimulatedObjectStore;
}

/**
 * INT-013 SIMULATED adapter over the CMP-032 storage ports (`@serviceform/storage`). In-process
 * only: nothing is written to the pod filesystem and nothing survives a restart, so it can never
 * be an authoritative store. Construction refuses non-simulation environments.
 */
export class SimulatedDocumentStorage implements DocumentStoragePort {
  readonly mode = 'SIMULATED' as const;
  readonly connectorBindingId: string;
  readonly simulation: SimulationMarker;
  private readonly store: SimulatedObjectStore;
  private readonly released = new Set<string>();

  constructor(private readonly opts: SimulatedDocumentStorageOptions) {
    this.connectorBindingId = opts.connectorBindingId;
    this.simulation = buildStorageSimulationMarker({
      environment: opts.environment,
      scenario: opts.scenario ?? 'document_upload',
      testRunId: opts.testRunId,
      storageBindingId: opts.connectorBindingId,
    });
    this.store = opts.store ?? new SimulatedObjectStore();
  }

  private assertOwned(tenantId: string, objectKey: string): void {
    if (!isKeyOwnedByTenant(objectKey, tenantId)) {
      throw new StoragePortError('OBJECT_NOT_OWNED', 'object key not owned by tenant');
    }
  }

  private async sign(parts: readonly string[]): Promise<string> {
    const key = await this.opts.secrets.getHmacKey(this.opts.secretName);
    return createHmac('sha256', Buffer.from(key)).update(parts.join('\n')).digest('hex');
  }

  async issueUploadTarget(input: {
    tenantId: string;
    objectKey: string;
    contentType: string;
    byteSize: number;
    checksumSha256: string;
    expiresAt: Date;
  }): Promise<UploadTarget> {
    this.assertOwned(input.tenantId, input.objectKey);
    const exp = Math.floor(input.expiresAt.getTime() / 1000);
    const params = new URLSearchParams({
      ct: input.contentType,
      len: String(input.byteSize),
      sha: input.checksumSha256,
      exp: String(exp),
    });
    const sig = await this.sign([
      'PUT',
      input.objectKey,
      input.contentType,
      String(input.byteSize),
      input.checksumSha256,
      String(exp),
    ]);
    params.set('sig', sig);
    return {
      method: 'PUT',
      url: `${UPLOAD_SCHEME}${encodeURIComponent(input.objectKey)}?${params.toString()}`,
      expires_at: input.expiresAt.toISOString(),
      required_headers: {
        'content-type': input.contentType,
        'x-checksum-sha256': input.checksumSha256,
      },
      simulation: this.simulation,
    };
  }

  /**
   * Simulates the client PUT straight to the object store (never through CMP-013). The store
   * records the checksum of the bytes actually received, so CMP-013 must verify integrity itself.
   */
  async simulateClientPut(
    url: string,
    bytes: Uint8Array,
    headers: { 'content-type': string },
    now: Date = new Date(),
  ): Promise<void> {
    if (!url.startsWith(UPLOAD_SCHEME)) {
      throw new StoragePortError('UPLOAD_URL_INVALID', 'not a simulated upload url');
    }
    const [path, query = ''] = url.slice(UPLOAD_SCHEME.length).split('?', 2);
    const objectKey = decodeURIComponent(path ?? '');
    const params = new URLSearchParams(query);
    const ct = params.get('ct') ?? '';
    const exp = Number(params.get('exp') ?? '0');
    const expected = await this.sign([
      'PUT',
      objectKey,
      ct,
      params.get('len') ?? '',
      params.get('sha') ?? '',
      String(exp),
    ]);
    const sig = params.get('sig') ?? '';
    const valid =
      sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!valid || now.getTime() / 1000 > exp || headers['content-type'] !== ct) {
      throw new StoragePortError('UPLOAD_URL_REFUSED', 'simulated upload refused');
    }
    await this.store.put({
      objectId: objectKey,
      objectKey,
      contentType: ct,
      bytes,
      checksumSha256: sha256Hex(bytes),
      mode: 'SIMULATED',
      simulation: this.simulation,
    });
  }

  async inspectObject(input: {
    tenantId: string;
    objectKey: string;
  }): Promise<ObjectInspection | null> {
    this.assertOwned(input.tenantId, input.objectKey);
    const found = await this.store.getBytes(input.objectKey);
    if (!found) return null;
    return {
      byte_size: found.bytes.byteLength,
      checksum_sha256: sha256Hex(found.bytes),
      head: found.bytes.slice(0, SNIFF_HEAD_BYTES),
    };
  }

  async releaseFromQuarantine(input: { tenantId: string; objectKey: string }): Promise<void> {
    this.assertOwned(input.tenantId, input.objectKey);
    if (!(await this.store.getBytes(input.objectKey))) {
      throw new StoragePortError('OBJECT_NOT_FOUND', 'object not found');
    }
    this.released.add(input.objectKey);
  }

  async discard(input: { tenantId: string; objectKey: string }): Promise<void> {
    this.assertOwned(input.tenantId, input.objectKey);
    this.released.delete(input.objectKey);
    if (await this.store.getBytes(input.objectKey)) await this.store.delete(input.objectKey);
  }

  async issueDownloadAccess(input: {
    tenantId: string;
    objectKey: string;
    expiresAt: Date;
  }): Promise<DownloadAccess> {
    this.assertOwned(input.tenantId, input.objectKey);
    if (!this.released.has(input.objectKey)) {
      throw new StoragePortError('OBJECT_QUARANTINED', 'object not released from quarantine');
    }
    const objectId = input.objectKey.split('/')[5] ?? '';
    const access = await createSimulatedPresign({
      secrets: this.opts.secrets,
      secretName: this.opts.secretName,
      objectId,
      objectKey: input.objectKey,
      expiresAt: input.expiresAt,
      simulation: this.simulation,
    });
    const out: DownloadAccess = { method: 'GET', url: access.url, expires_at: access.expiresAt };
    if (access.simulation) out.simulation = access.simulation;
    return out;
  }

  /** Simulator-to-simulator wiring for the SIMULATED malware scanner. */
  async readForScan(tenantId: string, objectKey: string): Promise<Uint8Array | null> {
    this.assertOwned(tenantId, objectKey);
    const found = await this.store.getBytes(objectKey);
    return found ? found.bytes : null;
  }

  isReleased(objectKey: string): boolean {
    return this.released.has(objectKey);
  }
}
