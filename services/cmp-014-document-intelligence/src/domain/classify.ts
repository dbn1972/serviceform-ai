import type { DocumentClass } from './states.js';

const CLASS_TOKEN = /\[class:([A-Z_]+)\]/;

const TOKEN_CLASS: Record<string, { documentClass: DocumentClass; confidence: number }> = {
  IDENTITY_DOCUMENT: { documentClass: 'IDENTITY_DOCUMENT', confidence: 0.86 },
  ADDRESS_PROOF: { documentClass: 'ADDRESS_PROOF', confidence: 0.88 },
  GENERIC: { documentClass: 'GENERIC', confidence: 0.7 },
};

/** Deterministic assistive classification from OCR tokens / content type. Never statutory. */
export function classifyDocument(input: { contentType: string; ocrText: string }): {
  documentClass: DocumentClass;
  confidence: number;
} {
  const token = CLASS_TOKEN.exec(input.ocrText)?.[1];
  const mapped = token === undefined ? undefined : TOKEN_CLASS[token];
  if (mapped) return mapped;
  if (input.contentType.startsWith('application/pdf')) {
    return { documentClass: 'GENERIC', confidence: 0.55 };
  }
  if (input.contentType.startsWith('image/')) return { documentClass: 'GENERIC', confidence: 0.5 };
  return { documentClass: 'UNKNOWN', confidence: 0.2 };
}
