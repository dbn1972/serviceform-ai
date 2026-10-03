export interface KmsEnvelope {
  key_ref: string;
  key_version: string;
  iv: string;
  tag: string;
  wrapped_dek: string;
  ciphertext: string;
}

export interface KmsProvider {
  encrypt(
    keyRef: string,
    plaintext: Uint8Array,
    context: Record<string, string>,
  ): Promise<KmsEnvelope>;
  decrypt(envelope: KmsEnvelope, context: Record<string, string>): Promise<Uint8Array>;
  sign(keyRef: string, data: Uint8Array): Promise<Uint8Array>;
  verify(keyRef: string, data: Uint8Array, sig: Uint8Array): Promise<boolean>;
}

export function canonicalAad(context: Record<string, string>): Buffer {
  const keys = Object.keys(context).sort();
  const ordered: Record<string, string> = {};
  for (const k of keys) {
    const v = context[k];
    if (v !== undefined) ordered[k] = v;
  }
  return Buffer.from(JSON.stringify(ordered), 'utf8');
}
