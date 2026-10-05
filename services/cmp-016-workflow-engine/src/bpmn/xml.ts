import { invalid } from '../errors.js';

/**
 * Minimal, hardened XML reader for the BPMN interoperability profile. Single linear pass over
 * the input (no backtracking regular expressions on document text). No DTDs, entities,
 * processing instructions (other than a leading XML declaration) or CDATA are accepted, so
 * external entity expansion is impossible. Only the five predefined character entities are
 * decoded.
 */
export interface XmlElement {
  name: string;
  local: string;
  attrs: Record<string, string>;
  children: XmlElement[];
}

export const MAX_XML_BYTES = 1_048_576;
const MAX_DEPTH = 32;
const MAX_ATTR_VALUE = 4096;
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function escapeXml(value: string): string {
  let out = '';
  for (const ch of value) {
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else if (ch === "'") out += '&apos;';
    else out += ch;
  }
  return out;
}

function isNameStart(c: string): boolean {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_';
}

function isNameChar(c: string): boolean {
  return isNameStart(c) || (c >= '0' && c <= '9') || c === '.' || c === ':' || c === '-';
}

function isSpace(c: string | undefined): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r';
}

function decode(raw: string): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const c = raw[i] as string;
    if (c === '<') throw invalid('BPMN_XML_MALFORMED');
    if (c !== '&') {
      out += c;
      i += 1;
      continue;
    }
    const end = raw.indexOf(';', i + 1);
    const value = end > i && end - i <= 6 ? ENTITIES[raw.slice(i + 1, end)] : undefined;
    if (value === undefined) throw invalid('BPMN_XML_ENTITY_FORBIDDEN');
    out += value;
    i = end + 1;
  }
  return out;
}

function localName(name: string): string {
  const i = name.indexOf(':');
  return i < 0 ? name : name.slice(i + 1);
}

class Scanner {
  pos = 0;
  constructor(readonly text: string) {}

  peek(offset = 0): string | undefined {
    return this.text[this.pos + offset];
  }

  startsWith(s: string): boolean {
    return this.text.startsWith(s, this.pos);
  }

  skipSpace(): void {
    while (isSpace(this.peek())) this.pos += 1;
  }

  name(): string {
    const start = this.pos;
    if (!isNameStart(this.peek() ?? '')) throw invalid('BPMN_XML_MALFORMED');
    while (isNameChar(this.peek() ?? '')) this.pos += 1;
    return this.text.slice(start, this.pos);
  }

  /** Skips to just after `terminator`; fails when it is absent. Linear (String#indexOf). */
  skipPast(terminator: string): void {
    const end = this.text.indexOf(terminator, this.pos);
    if (end < 0) throw invalid('BPMN_XML_MALFORMED');
    this.pos = end + terminator.length;
  }

  quoted(): string {
    const q = this.peek();
    if (q !== '"' && q !== "'") throw invalid('BPMN_XML_MALFORMED');
    const end = this.text.indexOf(q, this.pos + 1);
    if (end < 0 || end - this.pos - 1 > MAX_ATTR_VALUE) throw invalid('BPMN_XML_MALFORMED');
    const raw = this.text.slice(this.pos + 1, end);
    this.pos = end + 1;
    return decode(raw);
  }
}

/** Reads `<name attr="v" ...>` or `.../>` starting at '<'. */
function openTag(s: Scanner): { el: XmlElement; selfClosing: boolean } {
  s.pos += 1;
  const name = s.name();
  const attrs: Record<string, string> = {};
  for (;;) {
    const hadSpace = isSpace(s.peek());
    s.skipSpace();
    const c = s.peek();
    if (c === undefined) throw invalid('BPMN_XML_MALFORMED');
    if (c === '>') {
      s.pos += 1;
      return { el: { name, local: localName(name), attrs, children: [] }, selfClosing: false };
    }
    if (c === '/' && s.peek(1) === '>') {
      s.pos += 2;
      return { el: { name, local: localName(name), attrs, children: [] }, selfClosing: true };
    }
    if (!hadSpace) throw invalid('BPMN_XML_MALFORMED');
    const key = s.name();
    s.skipSpace();
    if (s.peek() !== '=') throw invalid('BPMN_XML_MALFORMED');
    s.pos += 1;
    s.skipSpace();
    if (Object.prototype.hasOwnProperty.call(attrs, key)) throw invalid('BPMN_XML_MALFORMED');
    attrs[key] = s.quoted();
  }
}

export function parseXml(xml: string): XmlElement {
  if (Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES) throw invalid('BPMN_XML_TOO_LARGE');
  const s = new Scanner(xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml);
  s.skipSpace();
  if (s.startsWith('<?xml') && isSpace(s.peek(5))) s.skipPast('?>');

  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  while (s.pos < s.text.length) {
    if (s.peek() !== '<') {
      s.pos += 1;
      continue;
    }
    if (s.startsWith('<!--')) {
      s.pos += 4;
      s.skipPast('-->');
      continue;
    }
    if (s.startsWith('<!')) throw invalid('BPMN_XML_DTD_FORBIDDEN');
    if (s.startsWith('<?')) throw invalid('BPMN_XML_PI_FORBIDDEN');
    if (s.startsWith('</')) {
      s.pos += 2;
      const name = s.name();
      s.skipSpace();
      if (s.peek() !== '>') throw invalid('BPMN_XML_MALFORMED');
      s.pos += 1;
      const open = stack.pop();
      if (!open || open.name !== name) throw invalid('BPMN_XML_MALFORMED');
      continue;
    }
    const { el, selfClosing } = openTag(s);
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(el);
    else if (root) throw invalid('BPMN_XML_MULTIPLE_ROOTS');
    else root = el;
    if (!selfClosing) {
      stack.push(el);
      if (stack.length > MAX_DEPTH) throw invalid('BPMN_XML_TOO_DEEP');
    }
  }
  if (!root || stack.length > 0) throw invalid('BPMN_XML_MALFORMED');
  return root;
}
