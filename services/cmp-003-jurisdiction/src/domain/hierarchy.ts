/** Max walk depth for containment edges. Not a geographic level name. */
export const MAX_HIERARCHY_DEPTH = 128;

export function wouldCycle(params: {
  childId: string;
  parentId: string | null;
  ancestorsOfParent: string[];
  depthHitLimit: boolean;
}): { cycle: boolean; depthExceeded: boolean } {
  if (params.parentId === null) return { cycle: false, depthExceeded: false };
  if (params.childId === params.parentId) return { cycle: true, depthExceeded: false };
  if (params.depthHitLimit) return { cycle: false, depthExceeded: true };
  return { cycle: params.ancestorsOfParent.includes(params.childId), depthExceeded: false };
}

/** Configurable type-code shape only — never hard-coded geographic level names. */
export const TYPE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export function isValidTypeCode(code: string): boolean {
  return TYPE_CODE_PATTERN.test(code);
}
