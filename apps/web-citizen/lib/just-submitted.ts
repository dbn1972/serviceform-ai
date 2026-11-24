/**
 * Applications submitted in this tab since the page loaded, so the status page can greet the
 * citizen once with a confirmation. Memory only (no browser storage): a reload or a later visit
 * shows the plain status page, and only an application id is held.
 */
const submitted = new Set<string>();

export function markJustSubmitted(id: string): void {
  submitted.add(id);
}

export function wasJustSubmitted(id: string): boolean {
  return submitted.has(id);
}

export function forgetJustSubmitted(id: string): void {
  submitted.delete(id);
}
