import { Cmp025Error, detail } from '../errors.js';
import { PARAM_NAME_RE } from './model.js';
import { looksLikePiiParamName } from './pii-guard.js';

const PLACEHOLDER = /\{\{\s*([^{}\s]+)\s*\}\}/g;

export function extractPlaceholders(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER)) names.add(match[1] as string);
  return [...names];
}

function hasStrayBraces(text: string): boolean {
  return (
    text.replace(PLACEHOLDER, '').includes('{{') || text.replace(PLACEHOLDER, '').includes('}}')
  );
}

export interface TemplateDefinition {
  subject_template: string | null;
  body_template: string;
  allowed_params: readonly string[];
}

/** Publish-time validation of template metadata; templates never carry PII-shaped parameters. */
export function assertTemplateDefinition(def: TemplateDefinition): void {
  const allowed = new Set(def.allowed_params);
  if (allowed.size !== def.allowed_params.length) {
    throw new Cmp025Error('SF-SYS-003', detail('DUPLICATE_PARAM', '/allowed_params'));
  }
  for (const name of allowed) {
    if (!PARAM_NAME_RE.test(name) || looksLikePiiParamName(name)) {
      throw new Cmp025Error('SF-SYS-003', detail('PII_PARAM_NAME_REFUSED', '/allowed_params'));
    }
  }
  for (const [pointer, text] of [
    ['/subject_template', def.subject_template],
    ['/body_template', def.body_template],
  ] as const) {
    if (text === null) continue;
    if (hasStrayBraces(text)) {
      throw new Cmp025Error('SF-SYS-003', detail('MALFORMED_PLACEHOLDER', pointer));
    }
    for (const name of extractPlaceholders(text)) {
      if (!allowed.has(name)) {
        throw new Cmp025Error('SF-SYS-003', detail('PLACEHOLDER_NOT_ALLOWED', pointer));
      }
    }
  }
}

function substitute(text: string, params: Readonly<Record<string, string>>): string {
  return text.replace(PLACEHOLDER, (_m, name: string) => params[name] as string);
}

export interface Rendered {
  subject: string | null;
  body: string;
}

/** Strict deterministic rendering: every placeholder bound, no unknown parameters, no evaluation. */
export function renderTemplate(
  def: TemplateDefinition,
  params: Readonly<Record<string, string>>,
): Rendered {
  const allowed = new Set(def.allowed_params);
  for (const name of Object.keys(params)) {
    if (!allowed.has(name)) {
      throw new Cmp025Error('SF-SYS-003', detail('PARAM_NOT_ALLOWED', '/template_params'));
    }
  }
  const needed = new Set([
    ...extractPlaceholders(def.body_template),
    ...(def.subject_template === null ? [] : extractPlaceholders(def.subject_template)),
  ]);
  for (const name of needed) {
    if (!Object.hasOwn(params, name)) {
      throw new Cmp025Error('SF-SYS-003', detail('PARAM_MISSING', '/template_params'));
    }
  }
  return {
    subject: def.subject_template === null ? null : substitute(def.subject_template, params),
    body: substitute(def.body_template, params),
  };
}
