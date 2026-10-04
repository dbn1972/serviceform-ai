export function frozenClock(iso: string): () => Date {
  const fixed = new Date(iso);
  return () => new Date(fixed.getTime());
}
