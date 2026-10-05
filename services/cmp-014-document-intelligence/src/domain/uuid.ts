/** Linear UUID shape check — avoids ambiguous quantifier regexes. */
export function isUuid(value: string): boolean {
  if (value.length !== 36) return false;
  const parts = value.split('-');
  if (parts.length !== 5) return false;
  const lengths = [8, 4, 4, 4, 12] as const;
  for (let i = 0; i < 5; i += 1) {
    const part = parts[i];
    if (!part || part.length !== lengths[i]) return false;
    for (let j = 0; j < part.length; j += 1) {
      const c = part.charCodeAt(j);
      const isDigit = c >= 48 && c <= 57;
      const isLower = c >= 97 && c <= 102;
      const isUpper = c >= 65 && c <= 70;
      if (!isDigit && !isLower && !isUpper) return false;
    }
  }
  return true;
}
