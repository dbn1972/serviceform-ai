const REDACTED = '[REDACTED]';

/** Opaque secret. JSON, string and inspect never expose the value. */
export class SecretMaterial {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return REDACTED;
  }
}

export interface SecretResolver {
  resolve(secretRef: string): Promise<SecretMaterial>;
}
