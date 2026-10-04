import { describe, expect, it } from 'vitest';
import { containsSensitive, mergeSummaries, redactText } from '../../src/domain/redaction.js';
import { synthetic } from '../doubles/synthetic.js';

describe('redaction (AI-GOVERNANCE data classification/redaction)', () => {
  const cases: [string, string, string][] = [
    ['EMAIL', synthetic.email(), 'contact'],
    ['NATIONAL_ID', synthetic.nationalId(), 'id'],
    ['TAX_ID', synthetic.taxId(), 'tax'],
    ['PHONE', synthetic.phone(), 'phone'],
    ['PAYMENT_CARD', synthetic.card(), 'card'],
    ['BEARER_TOKEN', synthetic.bearer(), 'hdr'],
    ['CREDENTIAL', synthetic.credential(), 'cfg'],
    ['CLOUD_ACCESS_KEY', synthetic.cloudKey(), 'key'],
    ['JWT', synthetic.jwt(), 'jwt'],
    ['PRIVATE_KEY', synthetic.privateKey(), 'pem'],
    ['URL_CREDENTIAL', synthetic.urlCredential(), 'url'],
  ];

  it.each(cases)('redacts %s and never retains the value', (category, value, label) => {
    const out = redactText(`${label}: ${value} end`);
    expect(out.text).not.toContain(value);
    expect(out.text).toContain(`[REDACTED:${category}]`);
    expect(out.summary[category as keyof typeof out.summary]).toBeGreaterThanOrEqual(1);
    expect(containsSensitive(value)).toBe(true);
  });

  it('redacts a card embedded inside a longer digit run and leaves short numbers alone', () => {
    const out = redactText(`ref 12 ${synthetic.card()} 34`);
    expect(out.text).not.toContain('4111');
    expect(out.summary.PAYMENT_CARD).toBe(1);
    expect(redactText('order 12 34 reviewed on 2026-10-04').total).toBe(0);
    expect(redactText('Summarise the policy for office hours.').total).toBe(0);
  });

  it('merges summaries', () => {
    expect(mergeSummaries({ EMAIL: 1 }, { EMAIL: 2, PHONE: 1 })).toEqual({ EMAIL: 3, PHONE: 1 });
  });

  it('handles large hostile input in linear time', () => {
    const hostile = 'a'.repeat(200_000) + '@' + '-'.repeat(50_000);
    const start = Date.now();
    redactText(hostile);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
