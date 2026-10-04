/**
 * Content sniffing from leading bytes. The declared MIME type and any client filename are
 * untrusted; only types whose signature can be verified here may appear in an upload policy,
 * so an unverifiable type fails closed.
 */
export const SNIFF_HEAD_BYTES = 16;

interface Signature {
  contentType: string;
  matches(head: Uint8Array): boolean;
}

function startsWith(head: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  if (head.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (head[offset + i] !== bytes[i]) return false;
  }
  return true;
}

function ascii(text: string): number[] {
  return Array.from(text, (c) => c.charCodeAt(0));
}

const SIGNATURES: readonly Signature[] = [
  { contentType: 'application/pdf', matches: (h) => startsWith(h, ascii('%PDF-')) },
  {
    contentType: 'image/png',
    matches: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { contentType: 'image/jpeg', matches: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  {
    contentType: 'image/gif',
    matches: (h) => startsWith(h, ascii('GIF87a')) || startsWith(h, ascii('GIF89a')),
  },
  {
    contentType: 'image/tiff',
    matches: (h) =>
      startsWith(h, [0x49, 0x49, 0x2a, 0x00]) || startsWith(h, [0x4d, 0x4d, 0x00, 0x2a]),
  },
  {
    contentType: 'image/webp',
    matches: (h) => startsWith(h, ascii('RIFF')) && startsWith(h, ascii('WEBP'), 8),
  },
];

export const SNIFFABLE_CONTENT_TYPES: readonly string[] = SIGNATURES.map((s) => s.contentType);

export function isSniffableContentType(contentType: string): boolean {
  return SNIFFABLE_CONTENT_TYPES.includes(contentType);
}

export function sniffContentType(head: Uint8Array): string | null {
  for (const sig of SIGNATURES) {
    if (sig.matches(head)) return sig.contentType;
  }
  return null;
}
