export function frozenClock(iso: string): () => Date {
  return () => new Date(iso);
}
