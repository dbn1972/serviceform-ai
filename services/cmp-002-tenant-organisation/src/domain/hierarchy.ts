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
