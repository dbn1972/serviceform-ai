import catalog from '../vendor/ux4g-3.0.0-tokens.json' with { type: 'json' };

type TokenMap = Record<string, string>;

const LIGHT = catalog.light as TokenMap;
const HEX = catalog.hexPrimitives as TokenMap;

function parseCssVarRef(raw: string): string | undefined {
  if (!raw.startsWith('var(') || !raw.endsWith(')')) return undefined;
  const inner = raw.slice(4, -1);
  const comma = inner.indexOf(',');
  const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
  if (!name.startsWith('--ux4g-')) return undefined;
  return name;
}

export function resolveLightToken(name: string, seen: string[] = []): string | undefined {
  if (seen.includes(name)) return undefined;
  const direct = HEX[name];
  if (direct) return direct;
  const raw = LIGHT[name];
  if (!raw) return undefined;
  const nested = parseCssVarRef(raw);
  if (nested) return resolveLightToken(nested, [...seen, name]);
  return raw;
}

function requiredToken(name: string): string {
  const value = resolveLightToken(name);
  if (!value) {
    throw new Error(`UX4G_TOKEN_MISSING:${name}`);
  }
  return value;
}

export const UX4G_HEX_PRIMITIVES: Readonly<TokenMap> = HEX;

export const UX4G_SEMANTIC_RESOLVED = {
  '--ux4g-text-neutral-primary': requiredToken('--ux4g-text-neutral-primary'),
  '--ux4g-text-neutral-secondary': requiredToken('--ux4g-text-neutral-secondary'),
  '--ux4g-text-neutral-inverse': requiredToken('--ux4g-text-neutral-inverse'),
  '--ux4g-bg-neutral-elevated': requiredToken('--ux4g-bg-neutral-elevated'),
  '--ux4g-color-primary-500': requiredToken('--ux4g-color-primary-500'),
  '--ux4g-color-primary-600': requiredToken('--ux4g-color-primary-600'),
} as const;
