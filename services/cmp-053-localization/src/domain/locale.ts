function isLower(c: number): boolean {
  return c >= 97 && c <= 122;
}
function isUpper(c: number): boolean {
  return c >= 65 && c <= 90;
}
function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}
function isAlnum(c: number): boolean {
  return isLower(c) || isUpper(c) || isDigit(c);
}

export function isLocaleTag(value: string): boolean {
  const parts = value.split('-');
  if (parts.length < 1 || parts.length > 5) return false;
  const lang = parts[0];
  if (!lang || lang.length < 2 || lang.length > 3) return false;
  for (let i = 0; i < lang.length; i += 1) {
    if (!isLower(lang.charCodeAt(i))) return false;
  }
  for (let p = 1; p < parts.length; p += 1) {
    const sub = parts[p];
    if (!sub || sub.length < 2 || sub.length > 8) return false;
    for (let i = 0; i < sub.length; i += 1) {
      if (!isAlnum(sub.charCodeAt(i))) return false;
    }
  }
  return true;
}

export function isMessageKey(value: string): boolean {
  if (value.length < 1 || value.length > 199) return false;
  const first = value.charCodeAt(0);
  if (!isLower(first)) return false;
  for (let i = 1; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c === 46 || c === 95 || c === 45) continue;
    if (!isLower(c) && !isDigit(c)) return false;
  }
  return true;
}

export function isCatalogCode(value: string): boolean {
  if (value.length < 2 || value.length > 64) return false;
  if (!isUpper(value.charCodeAt(0))) return false;
  for (let i = 1; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c === 95) continue;
    if (!isUpper(c) && !isDigit(c)) return false;
  }
  return true;
}

export function isSkeleton(value: string): boolean {
  if (value.length < 1 || value.length > 32) return false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (!isLower(c) && !isUpper(c)) return false;
  }
  return true;
}

export function parentTag(tag: string): string | null {
  const i = tag.lastIndexOf('-');
  return i > 0 ? tag.slice(0, i) : null;
}

export function fallbackChain(params: {
  requested: string;
  configuredFallback: string | null;
  defaultTag: string | null;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (tag: string | null | undefined): void => {
    if (!tag || seen.has(tag)) return;
    seen.add(tag);
    out.push(tag);
  };
  push(params.requested);
  push(params.configuredFallback);
  let current: string | null = parentTag(params.requested);
  while (current) {
    push(current);
    current = parentTag(current);
  }
  push(params.defaultTag);
  return out;
}

export function fallbackCycle(tag: string, fallbackByTag: Map<string, string | null>): boolean {
  const seen = new Set<string>();
  let current: string | null | undefined = tag;
  while (current) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = fallbackByTag.get(current) ?? null;
  }
  return false;
}
