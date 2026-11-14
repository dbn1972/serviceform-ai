/**
 * Browser-local list of recently saved designer drafts (document ids and keys only). A convenience
 * for reopening drafts; CMP-033 remains the only source of truth for document state.
 */
export interface RecentDraft {
  id: string;
  kind?: 'FORM' | 'WORKFLOW' | 'RULES';
  key: string;
  title: string;
  status: string;
  at: string;
}

const KEY = 'sf.studio.forms.recent';
const MAX = 8;

export function readRecent(): RecentDraft[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as RecentDraft[]).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberDraft(entry: Omit<RecentDraft, 'at'>): void {
  try {
    const next = [
      { ...entry, at: new Date().toISOString() },
      ...readRecent().filter((d) => d.id !== entry.id),
    ].slice(0, MAX);
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: nothing to remember */
  }
}
