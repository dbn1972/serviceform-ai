import { UX4G_OVERLAY_ALLOWLIST } from './generated/overlay-allowlist';
import { UX4G_SEMANTIC_RESOLVED } from './catalog';
import { contrastRatio, WCAG_AA_NORMAL_TEXT, WCAG_AA_UI } from './contrast';

const ALLOWED = new Set<string>(UX4G_OVERLAY_ALLOWLIST);
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const TENANT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const TOKEN_NAME = /^--ux4g-[a-z0-9-]+$/;

export class TenantOverlayError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'TenantOverlayError';
    this.code = code;
  }
}

export type TenantOverlayInput = {
  tenantId: string;
  tokens: Record<string, string>;
};

export type TenantOverlay = {
  tenantId: string;
  tokens: Readonly<Record<string, string>>;
  cssText: string;
};

function cssEscapeIdent(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, '');
}

/**
 * Tenant branding is a validated token overlay only (DESIGN-SYSTEM.md rule 4).
 * Output CSS is scoped to `[data-tenant-id="…"]` so tenant A cannot leak into tenant B.
 */
export function applyTenantOverlay(input: TenantOverlayInput): TenantOverlay {
  if (!TENANT_ID.test(input.tenantId)) {
    throw new TenantOverlayError('UX4G_TENANT_ID_INVALID', 'Tenant id is not a safe overlay scope');
  }
  const tokens: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(input.tokens)) {
    const name = rawName.trim();
    const value = rawValue.trim();
    if (!TOKEN_NAME.test(name) || !ALLOWED.has(name)) {
      throw new TenantOverlayError(
        'UX4G_OVERLAY_TOKEN_FORBIDDEN',
        `Token ${name} is not overlay-allowlisted`,
      );
    }
    if (!HEX.test(value) || /[;{}]|url\(|expression|javascript:/i.test(value)) {
      throw new TenantOverlayError(
        'UX4G_OVERLAY_VALUE_FORBIDDEN',
        `Token ${name} is not a hex overlay value`,
      );
    }
    tokens[name] = value.toLowerCase();
  }
  assertOverlayContrast(tokens);
  const decls = Object.entries(tokens)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  const scope = cssEscapeIdent(input.tenantId);
  const cssText = `[data-tenant-id="${scope}"]{${decls}}`;
  return { tenantId: input.tenantId, tokens, cssText };
}

function assertOverlayContrast(overlay: Record<string, string>): void {
  const bodyFg = UX4G_SEMANTIC_RESOLVED['--ux4g-text-neutral-primary'];
  const bodyBg = UX4G_SEMANTIC_RESOLVED['--ux4g-bg-neutral-elevated'];
  if (contrastRatio(bodyFg, bodyBg) < WCAG_AA_NORMAL_TEXT) {
    throw new TenantOverlayError('UX4G_OVERLAY_CONTRAST', 'Baseline body contrast failed');
  }
  const primary =
    overlay['--ux4g-color-primary-600'] ?? UX4G_SEMANTIC_RESOLVED['--ux4g-color-primary-600'];
  const onPrimary = UX4G_SEMANTIC_RESOLVED['--ux4g-text-neutral-inverse'];
  if (primary && contrastRatio(onPrimary, primary) < WCAG_AA_UI) {
    throw new TenantOverlayError(
      'UX4G_OVERLAY_CONTRAST',
      'Primary brand overlay fails UI contrast',
    );
  }
}

/** INT-011: overlays for different tenants must not share CSS scope or mutate a global token table. */
export function assertNoCrossTenantLeakage(a: TenantOverlay, b: TenantOverlay): void {
  if (a.tenantId === b.tenantId) {
    throw new TenantOverlayError('UX4G_OVERLAY_SAME_TENANT', 'Leakage check requires two tenants');
  }
  if (
    a.cssText.includes(`data-tenant-id="${b.tenantId}"`) ||
    b.cssText.includes(`data-tenant-id="${a.tenantId}"`)
  ) {
    throw new TenantOverlayError(
      'UX4G_CROSS_TENANT_LEAKAGE',
      'Overlay CSS includes the other tenant scope',
    );
  }
  for (const [name, value] of Object.entries(a.tokens)) {
    if (
      b.tokens[name] !== undefined &&
      b.tokens[name] !== value &&
      a.cssText.includes(b.tokens[name])
    ) {
      throw new TenantOverlayError(
        'UX4G_CROSS_TENANT_LEAKAGE',
        'Tenant A CSS contains Tenant B token value',
      );
    }
  }
}
