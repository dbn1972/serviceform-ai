import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';
import type { SecretsProvider } from '../secrets/secrets-provider.js';
import { assertLocalEnvironment } from '../secrets/secrets-provider.js';
import { canonicalAad, type KmsEnvelope, type KmsProvider } from './kms-provider.js';

const seenIv = new Set<string>();

export class LocalKms implements KmsProvider {
  constructor(private readonly secrets: SecretsProvider) {
    assertLocalEnvironment();
  }

  private async wrapKey(keyRef: string): Promise<Buffer> {
    const secret = await this.secrets.get({ provider: 'local', name: keyRef });
    try {
      const raw = secret.reveal();
      if (raw.length < 32) throw new Error('wrap key too short');
      return Buffer.from(raw.subarray(0, 32));
    } finally {
      secret.dispose();
    }
  }

  async encrypt(
    keyRef: string,
    plaintext: Uint8Array,
    context: Record<string, string>,
  ): Promise<KmsEnvelope> {
    const wrap = await this.wrapKey(keyRef);
    const dek = randomBytes(32);
    let iv = randomBytes(12);
    const ivHex = iv.toString('hex');
    if (seenIv.has(`${keyRef}:${ivHex}`)) iv = randomBytes(12);
    seenIv.add(`${keyRef}:${iv.toString('hex')}`);
    const aad = canonicalAad(context);
    const dataCipher = createCipheriv('aes-256-gcm', dek, iv);
    dataCipher.setAAD(aad);
    const ciphertext = Buffer.concat([dataCipher.update(plaintext), dataCipher.final()]);
    const tag = dataCipher.getAuthTag();
    const wrapIv = randomBytes(12);
    const wrapCipher = createCipheriv('aes-256-gcm', wrap, wrapIv);
    const wrapped = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
    const wrapTag = wrapCipher.getAuthTag();
    dek.fill(0);
    wrap.fill(0);
    return {
      key_ref: keyRef,
      key_version: '1',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      wrapped_dek: Buffer.concat([wrapIv, wrapTag, wrapped]).toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  async decrypt(envelope: KmsEnvelope, context: Record<string, string>): Promise<Uint8Array> {
    const wrap = await this.wrapKey(envelope.key_ref);
    const packed = Buffer.from(envelope.wrapped_dek, 'base64');
    const wrapIv = packed.subarray(0, 12);
    const wrapTag = packed.subarray(12, 28);
    const wrapped = packed.subarray(28);
    const wrapDec = createDecipheriv('aes-256-gcm', wrap, wrapIv);
    wrapDec.setAuthTag(wrapTag);
    let dek: Buffer;
    try {
      dek = Buffer.concat([wrapDec.update(wrapped), wrapDec.final()]);
    } catch {
      wrap.fill(0);
      throw new Error('unwrap failed');
    }
    wrap.fill(0);
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const dec = createDecipheriv('aes-256-gcm', dek, iv);
    dec.setAAD(canonicalAad(context));
    dec.setAuthTag(tag);
    try {
      return Buffer.concat([dec.update(Buffer.from(envelope.ciphertext, 'base64')), dec.final()]);
    } catch {
      throw new Error('decrypt failed');
    } finally {
      dek.fill(0);
    }
  }

  async sign(keyRef: string, data: Uint8Array): Promise<Uint8Array> {
    const secret = await this.secrets.get({ provider: 'local', name: keyRef });
    try {
      const pem = secret.revealText();
      const key = createPrivateKey(pem);
      return sign(null, data, key);
    } finally {
      secret.dispose();
    }
  }

  async verify(keyRef: string, data: Uint8Array, sig: Uint8Array): Promise<boolean> {
    const secret = await this.secrets.get({ provider: 'local', name: `${keyRef}_PUB` });
    try {
      const pem = secret.revealText();
      const key = createPublicKey(pem);
      return verify(null, data, key, sig);
    } finally {
      secret.dispose();
    }
  }
}
