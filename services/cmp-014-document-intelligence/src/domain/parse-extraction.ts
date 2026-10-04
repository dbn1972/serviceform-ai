/**
 * Decision boundary: CMP-014 extraction is assistive. It must not establish eligibility,
 * approve/reject, satisfy evidence, issue entitlement, or override deterministic rules.
 */
const BINDING =
  /\b(eligible|eligibility|approved|rejected|entitled|entitlement|hereby (approve|reject|grant|deny))\b/i;

export function assertsBindingDecision(text: string): boolean {
  return BINDING.test(text);
}

export interface ExtractedField {
  name: string;
  value: string;
  value_hash: string;
  confidence: number;
}

export interface ExtractionParse {
  fields: ExtractedField[];
  overall: number;
  unsafe: boolean;
}

const NAME = /^[a-z][a-z0-9_]{0,63}$/;

export function parseGatewayExtraction(
  outputText: string,
  hash: (value: string) => string,
): ExtractionParse {
  if (assertsBindingDecision(outputText)) {
    return { fields: [], overall: 0, unsafe: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText) as unknown;
  } catch {
    return { fields: [], overall: 0, unsafe: false };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { fields: [], overall: 0, unsafe: false };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj['statutory_decision'] === true || obj['advisory_only'] === false) {
    return { fields: [], overall: 0, unsafe: true };
  }
  const rawFields = obj['fields'];
  if (!Array.isArray(rawFields)) return { fields: [], overall: 0, unsafe: false };
  const fields: ExtractedField[] = [];
  for (const row of rawFields) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    const rec = row as Record<string, unknown>;
    const name = rec['name'];
    const value = rec['value'];
    const confidence = rec['confidence'];
    if (typeof name !== 'string' || !NAME.test(name)) continue;
    if (typeof value !== 'string' || value.length === 0 || value.length > 500) continue;
    if (typeof confidence !== 'number' || !(confidence >= 0 && confidence <= 1)) continue;
    if (assertsBindingDecision(`${name} ${value}`)) {
      return { fields: [], overall: 0, unsafe: true };
    }
    fields.push({ name, value, value_hash: hash(value), confidence });
  }
  const overall =
    typeof obj['overall_confidence'] === 'number' &&
    obj['overall_confidence'] >= 0 &&
    obj['overall_confidence'] <= 1
      ? obj['overall_confidence']
      : fields.reduce((min, f) => Math.min(min, f.confidence), 1);
  return { fields, overall: fields.length === 0 ? 0 : overall, unsafe: false };
}

export function publicFields(
  fields: readonly ExtractedField[],
): { name: string; value_hash: string; confidence: number }[] {
  return fields.map((f) => ({ name: f.name, value_hash: f.value_hash, confidence: f.confidence }));
}
