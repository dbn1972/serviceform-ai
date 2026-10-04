import { UX4G_OVERLAY_ALLOWLIST } from './generated/overlay-allowlist';
import { UX4G_HEX_PRIMITIVES, UX4G_SEMANTIC_RESOLVED } from './catalog';

export const UX4G_BASELINE = {
  name: 'UX4G Design System',
  version: '3.0',
  package: 'ux4g-web-components',
  packageVersion: '3.0.0',
  vendored: true,
} as const;

export function isOverlayToken(name: string): boolean {
  return (UX4G_OVERLAY_ALLOWLIST as readonly string[]).includes(name);
}

export { UX4G_OVERLAY_ALLOWLIST, UX4G_HEX_PRIMITIVES, UX4G_SEMANTIC_RESOLVED };
