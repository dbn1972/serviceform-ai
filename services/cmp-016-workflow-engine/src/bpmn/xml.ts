import { invalid } from '../errors.js';

/**
 * Minimal, hardened XML reader for the BPMN interoperability profile. No DTDs, entities,
 * processing instructions (other than the XML declaration) or CDATA are accepted, so external
 * entity expansion is impossible. Only the five predefined character entities are decoded.
 */
export interface XmlElement {
  name: string;
  local: string;
  attrs: Record<string, string>;
  children: XmlElement[];
}

export const MAX_XML_BYTES = 1_048_576;
const MAX_DEPTH = 32;
const NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function decode(value: string): string {
  return value.replace(/&[a-zA-Z#0-9]+;/g, (m) => {
    const v = ENTITIES[m];
    if (v === undefined) throw invalid('BPMN_XML_ENTITY_FORBIDDEN');
    return v;
  });
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function localName(name: string): string {
  const i = name.indexOf(':');
  return i < 0 ? name : name.slice(i + 1);
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /\s*([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/y;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw invalid('BPMN_XML_MALFORMED');
    const key = m[1] as string;
    if (!NAME.test(key) || key in attrs) throw invalid('BPMN_XML_MALFORMED');
    attrs[key] = decode(m[3] ?? m[4] ?? '');
    pos = re.lastIndex;
  }
  return attrs;
}

export function parseXml(xml: string): XmlElement {
  if (Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES) throw invalid('BPMN_XML_TOO_LARGE');
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml)) throw invalid('BPMN_XML_DTD_FORBIDDEN');
  let text = xml.replace(/^\uFEFF/, '');
  text = text.replace(/^\s*<\?xml[^?]*\?>/, '');
  if (text.includes('<?')) throw invalid('BPMN_XML_PI_FORBIDDEN');
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  const tag = /<(\/?)([^\s/>]+)([^>]*?)(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(text)) !== null) {
    if (text.slice(last, m.index).includes('<')) throw invalid('BPMN_XML_MALFORMED');
    last = tag.lastIndex;
    const [, closing, name, rawAttrs, selfClosing] = m as unknown as [
      string,
      string,
      string,
      string,
      string,
    ];
    if (!NAME.test(name)) throw invalid('BPMN_XML_MALFORMED');
    if (closing) {
      const open = stack.pop();
      if (!open || open.name !== name || rawAttrs.trim() !== '')
        throw invalid('BPMN_XML_MALFORMED');
      continue;
    }
    const el: XmlElement = {
      name,
      local: localName(name),
      attrs: parseAttrs(rawAttrs),
      children: [],
    };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(el);
    else if (root) throw invalid('BPMN_XML_MULTIPLE_ROOTS');
    else root = el;
    if (!selfClosing) {
      stack.push(el);
      if (stack.length > MAX_DEPTH) throw invalid('BPMN_XML_TOO_DEEP');
    }
  }
  if (text.slice(last).includes('<')) throw invalid('BPMN_XML_MALFORMED');
  if (!root || stack.length > 0) throw invalid('BPMN_XML_MALFORMED');
  return root;
}
