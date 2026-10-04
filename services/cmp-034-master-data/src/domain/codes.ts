export const SET_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
export const VALUE_CODE = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
export const MAX_IMPORT_ITEMS = 500;

export function isValidSetCode(value: string): boolean {
  return SET_CODE.test(value);
}

export function isValidValueCode(value: string): boolean {
  return VALUE_CODE.test(value);
}

export function parseVersionNo(raw: string): number {
  if (!/^[1-9][0-9]{0,8}$/.test(raw)) return Number.NaN;
  return Number(raw);
}
