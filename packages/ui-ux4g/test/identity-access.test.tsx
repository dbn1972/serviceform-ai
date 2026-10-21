import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Checkbox,
  Icon,
  OtpInput,
  RadioGroup,
  TextInput,
  UX4G_FIGMA_INVENTORY,
} from '../src/index';

const noop = () => undefined;
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// REQ: DESIGN-SYSTEM.md rules 1-3, 6; UX4G 3.0 Identity & Access (OTP input) contract.
describe('TextInput follows the UX4G field DOM contract', () => {
  it('wraps the native input in the bordered ux4g-input box', () => {
    const html = renderToStaticMarkup(<TextInput id="m" label="Mobile number" />);
    expect(html).toMatch(/<div class="ux4g-input"><input id="m" class="ux4g-input-input"/);
  });

  it('announces the prefix and hint, and marks optional fields in the label', () => {
    const html = renderToStaticMarkup(
      <TextInput id="m" label="Mobile number" prefix="+91" hint="SMS only" optional />,
    );
    expect(html).toContain('<span class="ux4g-input-prefix" id="m-prefix">+91</span>');
    expect(html).toContain('aria-describedby="m-prefix m-hint"');
    expect(html).toContain('(optional)');
  });

  it('switches to the error state and replaces the hint with the error message', () => {
    const html = renderToStaticMarkup(
      <TextInput id="n" label="Full name" hint="As on record" error="Enter your full name" />,
    );
    expect(html).toContain('ux4g-input-error');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="n-error"');
    expect(html).toContain('Enter your full name');
    expect(html).not.toContain('As on record');
  });
});

describe('OtpInput (UX4G ux4g-otp)', () => {
  it('renders one labelled numeric slot per digit inside a fieldset', () => {
    const html = renderToStaticMarkup(
      <OtpInput id="otp" label="One-time password" value="12" onChange={noop} />,
    );
    expect(html).toContain('<fieldset class="ux4g-otp sf-otp ux4g-otp-default">');
    expect(html).toContain('<legend');
    expect(html.match(/class="ux4g-input ux4g-otp-slot"/g)).toHaveLength(6);
    expect(html.match(/inputMode="numeric"/g)).toHaveLength(6);
    expect(html).toContain('aria-label="Digit 1 of 6"');
    expect(html).toContain('aria-label="Digit 6 of 6"');
    expect(html.match(/autoComplete="one-time-code"/g)).toHaveLength(1);
    expect(html).toContain('value="1"');
    expect(html).toContain('value="2"');
  });

  it('keeps positions when middle slots are empty', () => {
    const html = renderToStaticMarkup(
      <OtpInput id="otp" label="OTP" value="1 3" length={4} onChange={noop} />,
    );
    const values = [...html.matchAll(/value="(\d?)"/g)].map((m) => m[1]);
    expect(values).toEqual(['1', '', '3', '']);
  });

  it('exposes error status through a polite live region linked to every slot', () => {
    const html = renderToStaticMarkup(
      <OtpInput
        id="otp"
        label="OTP"
        value="000000"
        onChange={noop}
        state="error"
        status="Incorrect OTP"
      />,
    );
    expect(html).toContain('ux4g-otp-error');
    expect(html).toContain('<p id="otp-status" class="ux4g-otp-status" aria-live="polite">');
    expect(html.match(/aria-describedby="otp-status"/g)).toHaveLength(6);
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(6);
    expect(html).toContain('Incorrect OTP');
  });

  it('disables slots when locked but leaves the meta row (resend) interactive', () => {
    const html = renderToStaticMarkup(
      <OtpInput
        id="otp"
        label="OTP"
        value=""
        onChange={noop}
        state="locked"
        status="Too many attempts"
        meta={<button type="button">Resend OTP</button>}
      />,
    );
    expect(html.match(/disabled=""/g)).toHaveLength(6);
    expect(html).toContain('<button type="button">Resend OTP</button>');
    expect(html).not.toMatch(/<fieldset[^>]*disabled/);
  });
});

describe('Checkbox and RadioGroup render the UX4G marks', () => {
  it('renders ux4g-checkmark inside the control', () => {
    const html = renderToStaticMarkup(<Checkbox id="c" label="I agree" error />);
    expect(html).toContain('<span class="ux4g-checkmark"></span>');
    expect(html).toContain('ux4g-checkbox-error');
    expect(html).toContain('aria-invalid="true"');
  });

  it('renders ux4g-radiomark and accepts rich labels (lang of parts)', () => {
    const html = renderToStaticMarkup(
      <RadioGroup
        name="lang"
        legend="Language"
        options={[{ value: 'hi', label: <span lang="hi">हिन्दी</span> }]}
      />,
    );
    expect(html).toContain('<span class="ux4g-radiomark"></span>');
    expect(html).toContain('<span lang="hi">हिन्दी</span>');
  });
});

describe('Icon', () => {
  it('is decorative by default and named when labelled; inherits currentColor', () => {
    expect(renderToStaticMarkup(<Icon name="lock" />)).toContain('aria-hidden="true"');
    const named = renderToStaticMarkup(<Icon name="shield" label="Secure" />);
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Secure"');
    expect(named).toContain('stroke="currentColor"');
  });
});

describe('vendored UX4G 3.0 Identity & Access rules', () => {
  it('ships the OTP, divider, checkmark and radiomark primitives from ux4g-web-components', () => {
    for (const selector of [
      '.ux4g-otp-slot {',
      '.ux4g-otp-error .ux4g-otp-slot {',
      '.ux4g-divider-horizontal-text {',
      '.ux4g-checkmark {',
      '.ux4g-radiomark {',
    ]) {
      expect(css).toContain(selector);
    }
    expect(UX4G_FIGMA_INVENTORY.map((row) => row.code)).toContain('OtpInput');
  });

  it('honours reduced motion for the OTP shake and caret', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*{\s*\.ux4g-otp-group\.ux4g-otp-shake/);
  });
});
