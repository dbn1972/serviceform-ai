import { inspect, type InspectOptionsStylized } from 'node:util';

const HELD = new WeakMap<SecretValue, Uint8Array>();
const REDACTED = '[REDACTED]';

export class SecretValue {
  constructor(bytes: Uint8Array) {
    HELD.set(this, Uint8Array.from(bytes));
  }

  static fromString(value: string): SecretValue {
    return new SecretValue(new TextEncoder().encode(value));
  }

  reveal(): Uint8Array {
    const held = HELD.get(this);
    if (!held) throw new Error('secret disposed');
    return Uint8Array.from(held);
  }

  revealText(): string {
    return new TextDecoder().decode(this.reveal());
  }

  dispose(): void {
    const held = HELD.get(this);
    if (held) held.fill(0);
    HELD.delete(this);
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](_depth: number, _opts: InspectOptionsStylized): string {
    return REDACTED;
  }

  [Symbol.toPrimitive](): string {
    return REDACTED;
  }
}
