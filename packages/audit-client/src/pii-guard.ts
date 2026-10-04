import { PiiRejectedError } from './errors.js';

const DEVANAGARI = '०१२३४५६७८९';
const FULLWIDTH = '０１２３４５６７８９';
function stripZw(text: string): string {
  return text
    .replaceAll('\u200B', '')
    .replaceAll('\u200C', '')
    .replaceAll('\u200D', '')
    .replaceAll('\uFEFF', '');
}

function digitChar(ch: string): string | undefined {
  if (ch >= '0' && ch <= '9') return ch;
  const d = DEVANAGARI.indexOf(ch);
  if (d >= 0) return String(d);
  const f = FULLWIDTH.indexOf(ch);
  if (f >= 0) return String(f);
  return undefined;
}

function digitsOf(text: string): string {
  let out = '';
  for (const ch of stripZw(text)) {
    const d = digitChar(ch);
    if (d !== undefined) out += d;
  }
  return out;
}

/** Verhoeff checksum (Aadhaar). */
function verhoeffOk(num: string): boolean {
  const d = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  ];
  const p = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
  ];
  const inv = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];
  let c = 0;
  const reversed = num.split('').reverse();
  for (let i = 0; i < reversed.length; i += 1) {
    const item = Number(reversed[i]);
    const row = p[i % 8];
    if (row === undefined) return false;
    const mapped = row[item];
    const drow = d[c];
    if (mapped === undefined || drow === undefined) return false;
    const next = drow[mapped];
    if (next === undefined) return false;
    c = next;
  }
  return inv[c] === 0;
}

function luhnOk(num: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i -= 1) {
    let n = Number(num[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return num.length >= 13 && num.length <= 19 && sum % 10 === 0;
}

function containsAadhaar(text: string): boolean {
  const digits = digitsOf(text);
  for (let i = 0; i <= digits.length - 12; i += 1) {
    const slice = digits.slice(i, i + 12);
    if (verhoeffOk(slice)) return true;
  }
  return false;
}

function containsVid(text: string): boolean {
  const digits = digitsOf(text);
  for (let i = 0; i <= digits.length - 16; i += 1) {
    if (/^[0-9]{16}$/.test(digits.slice(i, i + 16))) return true;
  }
  return false;
}

function containsPan(text: string): boolean {
  const compact = stripZw(text).replace(/[\s-]/g, '');
  return /[A-Z]{5}[0-9]{4}[A-Z]/i.test(compact);
}

function containsEmail(text: string): boolean {
  const normalized = stripZw(text)
    .replace(/%40/gi, '@')
    .replace(/\s*\[\s*at\s*\]\s*/gi, '@');
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(normalized);
}

function containsMobile(text: string): boolean {
  const digits = digitsOf(text);
  if (/(?:^|[^0-9])[6-9][0-9]{9}(?:[^0-9]|$)/.test(digits)) return true;
  if (/(?:^|[^0-9])91[6-9][0-9]{9}(?:[^0-9]|$)/.test(digits)) return true;
  return false;
}

function containsCard(text: string): boolean {
  const digits = digitsOf(text);
  for (let len = 13; len <= 19; len += 1) {
    for (let i = 0; i <= digits.length - len; i += 1) {
      if (luhnOk(digits.slice(i, i + len))) return true;
    }
  }
  return false;
}

const DETECTORS: { name: string; fn: (t: string) => boolean }[] = [
  { name: 'AADHAAR', fn: containsAadhaar },
  { name: 'VID', fn: containsVid },
  { name: 'PAN', fn: containsPan },
  { name: 'EMAIL', fn: containsEmail },
  { name: 'MOBILE', fn: containsMobile },
  { name: 'CARD', fn: containsCard },
];

export function assertNoPii(pointer: string, value: string | undefined): void {
  if (value === undefined || value.length === 0) return;
  if (value.includes('\u0000')) {
    throw new PiiRejectedError(pointer, 'NUL');
  }
  for (const det of DETECTORS) {
    if (det.fn(value)) throw new PiiRejectedError(pointer, det.name);
  }
}

export function assertEventFreeText(event: {
  reason?: string;
  before_ref?: string;
  after_ref?: string;
}): void {
  assertNoPii('/reason', event.reason);
  assertNoPii('/before_ref', event.before_ref);
  assertNoPii('/after_ref', event.after_ref);
}
