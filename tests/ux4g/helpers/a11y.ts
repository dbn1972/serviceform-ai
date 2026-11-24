/**
 * Shared UX4G accessibility probes for any forms surface (gallery scenes, citizen apply, Studio
 * preview). Each probe returns findings instead of asserting, so specs choose what blocks.
 * REQ: DESIGN-SYSTEM.md rule 6; specs/design-system.yaml required_evidence (keyboard_tests,
 * automated_accessibility, responsive_reflow_200_percent, multilingual_truncation).
 */
import AxeBuilder from '@axe-core/playwright';
import type { ElementHandle, Page } from '@playwright/test';

export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

export async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
  return results.violations.map(
    (v) =>
      `[${v.impact}] ${v.id}: ${v.help} -> ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
  );
}

/** CSS px the document scrolls horizontally (WCAG 1.4.10). */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** Text-only resize (WCAG 1.4.4): UX4G tokens are rem-based, so this scales type and spacing. */
export async function resizeText(page: Page, percent: number): Promise<void> {
  await page.evaluate((p) => {
    document.documentElement.style.fontSize = `${p}%`;
  }, percent);
}

/** WCAG 1.4.12 text-spacing overrides (the W3C bookmarklet values); remove the returned tag to undo. */
export async function applyTextSpacing(page: Page): Promise<ElementHandle> {
  return page.addStyleTag({
    content:
      '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }' +
      ' p { margin-bottom: 2em !important; }',
  });
}

/**
 * Elements whose own text is cut off: they clip overflow and their content box is smaller than
 * their content. Visually-hidden (1px) text and scroll containers are excluded.
 */
export async function clippedText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const clipsX = ['hidden', 'clip'].includes(cs.overflowX);
      const clipsY = ['hidden', 'clip'].includes(cs.overflowY);
      if (!clipsX && !clipsY) continue;
      if (el.clientWidth <= 1 || el.clientHeight <= 1) continue;
      const text = (el.textContent ?? '').trim();
      if (!text) continue;
      const overX = clipsX && el.scrollWidth > el.clientWidth + 1;
      const overY = clipsY && el.scrollHeight > el.clientHeight + 1;
      if (overX || overY) {
        const id = el.id ? `#${el.id}` : '';
        const cls =
          el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '';
        out.push(`${el.tagName.toLowerCase()}${id}${cls} "${text.slice(0, 40)}"`);
      }
    }
    return out;
  });
}

type FocusStop = { label: string; visible: boolean; obscured: boolean };

/**
 * Tabs through the page and, for each stop, compares the pixels around the focused control
 * with the same region after blur. No pixel change means no visible focus indicator
 * (WCAG 2.4.7); a control whose centre is covered by another element is obscured (2.4.11).
 * Starts from the top of the document whatever had focus (live pages move focus to headings and
 * notices), and stops when focus leaves the page or returns to a control it already visited.
 */
export async function focusStops(page: Page, max = 200): Promise<FocusStop[]> {
  const stops: FocusStop[] = [];
  await page.evaluate(() => {
    const start = document.createElement('span');
    start.tabIndex = -1;
    document.body.prepend(start);
    start.focus();
    start.remove();
  });
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      if (el.hasAttribute('data-sf-focus-seen')) return null;
      el.setAttribute('data-sf-focus-seen', '');
      const box = (el.closest(
        'label, .ux4g-input, .ux4g-otp-slot, .ux4g-switch, .sf-upload-zone',
      ) ?? el) as HTMLElement;
      const union = [el, box].map((n) => n.getBoundingClientRect());
      const left = Math.min(...union.map((r) => r.left)) - 6;
      const top = Math.min(...union.map((r) => r.top)) - 6;
      const right = Math.max(...union.map((r) => r.right)) + 6;
      const bottom = Math.max(...union.map((r) => r.bottom)) + 6;
      const er = el.getBoundingClientRect();
      const cx = er.left + er.width / 2;
      const cy = er.top + er.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const sameControl =
        !!hit &&
        (hit === el ||
          el.contains(hit) ||
          hit.contains(el) ||
          (hit.closest('label') !== null && hit.closest('label') === el.closest('label')));
      const name =
        el.getAttribute('aria-label') ??
        (el.id
          ? document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()
          : undefined) ??
        el.textContent?.trim() ??
        el.tagName;
      return {
        label: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${(name ?? '').slice(0, 40)}"`,
        clip: {
          x: Math.max(0, left),
          y: Math.max(0, top),
          width: Math.max(1, Math.min(window.innerWidth, right) - Math.max(0, left)),
          height: Math.max(1, Math.min(window.innerHeight, bottom) - Math.max(0, top)),
        },
        obscured: er.width > 0 && er.height > 0 && !sameControl,
      };
    });
    if (!info) break;
    const focused = await page.screenshot({
      clip: info.clip,
      animations: 'disabled',
      caret: 'hide',
    });
    await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      el?.setAttribute('data-sf-focus-probe', '');
      el?.blur();
    });
    const blurred = await page.screenshot({
      clip: info.clip,
      animations: 'disabled',
      caret: 'hide',
    });
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-sf-focus-probe]');
      el?.removeAttribute('data-sf-focus-probe');
      el?.focus();
    });
    stops.push({ label: info.label, visible: !focused.equals(blurred), obscured: info.obscured });
  }
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('[data-sf-focus-seen]'))) {
      el.removeAttribute('data-sf-focus-seen');
    }
  });
  return stops;
}

/** Every invalid control exposes an accessible name and a visible, non-empty error description. */
export async function invalidFieldWiring(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const invalid = Array.from(
      document.querySelectorAll<HTMLElement>('[aria-invalid="true"], fieldset.ux4g-radio-error'),
    );
    for (const el of invalid) {
      const id = el.id || el.getAttribute('name') || el.tagName;
      const described = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      if (described.length === 0) {
        problems.push(`${id}: aria-invalid without aria-describedby`);
        continue;
      }
      const texts = described.map((d) => document.getElementById(d));
      if (texts.some((t) => !t)) problems.push(`${id}: aria-describedby points at a missing id`);
      const visibleText = texts.some(
        (t) => t && t.offsetParent !== null && (t.textContent ?? '').trim() !== '',
      );
      if (!visibleText) problems.push(`${id}: error description is empty or hidden`);
    }
    return problems;
  });
}

/** One h1 per page and no skipped heading levels among visible headings (1.3.1, 2.4.6). */
export async function headingOutline(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const headings = Array.from(
      document.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, [role="heading"]'),
    ).filter((h) => h.offsetParent !== null || getComputedStyle(h).position === 'fixed');
    const levels = headings.map((h) =>
      h.getAttribute('aria-level') ? Number(h.getAttribute('aria-level')) : Number(h.tagName[1]),
    );
    const problems: string[] = [];
    const h1 = levels.filter((l) => l === 1).length;
    if (h1 !== 1) problems.push(`expected one h1, found ${h1}`);
    levels.forEach((level, i) => {
      const prev = levels[i - 1];
      if (prev !== undefined && level > prev + 1) {
        const text = (headings[i]?.textContent ?? '').trim().slice(0, 40);
        problems.push(`h${prev} -> h${level} skips a level at "${text}"`);
      }
    });
    return problems;
  });
}

/** Status and alert regions present on the page, for status-message evidence (4.1.3). */
export async function liveRegions(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>('[role="status"], [role="alert"], [aria-live]'),
    ).map((el) => {
      const kind = el.getAttribute('role') ?? `aria-live=${el.getAttribute('aria-live')}`;
      return `${kind}: "${(el.textContent ?? '').trim().slice(0, 60)}"`;
    }),
  );
}

/**
 * Elements still animating or transitioning for longer than 10 ms under
 * `prefers-reduced-motion: reduce`. Informational: 2.3.3 is AAA, so specs record, not block.
 */
export async function motionUnderReducedMotion(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const seconds = (v: string) =>
      Math.max(
        0,
        ...v
          .split(',')
          .map((t) => (t.trim().endsWith('ms') ? parseFloat(t) / 1000 : parseFloat(t))),
      );
    const out = new Set<string>();
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      const animated = cs.animationName !== 'none' && seconds(cs.animationDuration) > 0.01;
      const transitioned =
        cs.transitionProperty !== 'none' && seconds(cs.transitionDuration) > 0.01;
      if (animated || transitioned) {
        const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
        out.add(
          `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} ${animated ? 'animation' : 'transition'}`,
        );
      }
    }
    return [...out];
  });
}

/** Form controls whose UX4G boundary disappears (no border) — checked under forced colours. */
export async function boundarylessControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const boxes = document.querySelectorAll<HTMLElement>(
      '.ux4g-input, textarea.ux4g-textarea, .ux4g-checkmark, .ux4g-radiomark, .ux4g-switch-track, .ux4g-otp-slot',
    );
    for (const el of Array.from(boxes)) {
      const cs = getComputedStyle(el);
      const widths = [
        cs.borderTopWidth,
        cs.borderRightWidth,
        cs.borderBottomWidth,
        cs.borderLeftWidth,
      ].map((w) => parseFloat(w));
      const styled = [cs.borderTopStyle, cs.borderBottomStyle].every(
        (s) => s !== 'none' && s !== 'hidden',
      );
      const hasOutline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      if (!(styled && widths.every((w) => w >= 1)) && !hasOutline) {
        out.push(`${el.className.split(' ')[0]}${el.id ? `#${el.id}` : ''}`);
      }
    }
    return out;
  });
}
