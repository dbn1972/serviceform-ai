const CATEGORY_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SLUG_CODE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const TAG = /^[a-z0-9-]{1,64}$/;
const TARGET_TYPE = /^[A-Z][A-Z0-9_]{1,63}$/;

export function isCategoryCode(value: string): boolean {
  return CATEGORY_CODE.test(value);
}

export function isSlugCode(value: string): boolean {
  return SLUG_CODE.test(value);
}

export function isTag(value: string): boolean {
  return TAG.test(value);
}

export function isTargetType(value: string): boolean {
  return TARGET_TYPE.test(value);
}

export function assertTags(tags: string[] | undefined): string[] {
  const list = tags ?? [];
  if (list.length > 32) return [];
  return list.filter((t) => isTag(t));
}
