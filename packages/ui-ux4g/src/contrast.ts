/** WCAG 2.1 relative luminance and contrast (DESIGN-SYSTEM.md accessibility). */

function expandHex(hex: string): string {
  const h = hex.trim().toLowerCase();
  if (h.length === 4 && h.startsWith('#')) {
    return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  return h;
}

function srgbChannel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const h = expandHex(hex).replace('#', '');
  if (h.length !== 6 || !/^[0-9a-f]+$/.test(h)) {
    throw new Error('UX4G_CONTRAST_HEX_INVALID');
  }
  const r = srgbChannel(parseInt(h.slice(0, 2), 16));
  const g = srgbChannel(parseInt(h.slice(2, 4), 16));
  const b = srgbChannel(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foregroundHex: string, backgroundHex: string): number {
  const l1 = relativeLuminance(foregroundHex);
  const l2 = relativeLuminance(backgroundHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export const WCAG_AA_NORMAL_TEXT = 4.5;
export const WCAG_AA_LARGE_TEXT = 3;
export const WCAG_AA_UI = 3;

export function meetsWcagAa(
  foregroundHex: string,
  backgroundHex: string,
  min = WCAG_AA_NORMAL_TEXT,
): boolean {
  return contrastRatio(foregroundHex, backgroundHex) >= min;
}
