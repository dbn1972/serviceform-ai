import { Cmp009Error } from '../errors.js';
import { isLocaleTag, MESSAGE_KEY_RE } from '../domain/canonical.js';
import { buildSimulationMarker, type FormsConfig } from '../config.js';
import type { SimulationMarker } from '@serviceform/contracts';

export interface LocalizationResolveRequest {
  tenantId: string;
  locale: string;
  keys: string[];
  correlationId: string;
}

export interface LocalizationResolveResult {
  locale: string;
  messages: Record<string, string>;
  simulation?: SimulationMarker;
}

/** CMP-053 localization contract consumed as a port; no SQL into sf_i18n. */
export interface LocalizationPort {
  resolve(request: LocalizationResolveRequest): Promise<LocalizationResolveResult>;
}

export class DenyLocalizationPort implements LocalizationPort {
  async resolve(_request: LocalizationResolveRequest): Promise<LocalizationResolveResult> {
    throw new Cmp009Error('SF-SYS-004', { details: [{ code: 'LOCALIZATION_UNAVAILABLE' }] });
  }
}

export class IdentityLocalizationPort implements LocalizationPort {
  async resolve(request: LocalizationResolveRequest): Promise<LocalizationResolveResult> {
    if (!isLocaleTag(request.locale)) {
      throw new Cmp009Error('SF-SYS-003', { details: [{ code: 'LOCALE_INVALID' }] });
    }
    const messages: Record<string, string> = {};
    for (const key of request.keys) {
      if (!MESSAGE_KEY_RE.test(key)) {
        throw new Cmp009Error('SF-SYS-003', { details: [{ code: 'MESSAGE_KEY_INVALID' }] });
      }
      messages[key] = key;
    }
    return { locale: request.locale, messages };
  }
}

export class SimulatedLocalizationPort implements LocalizationPort {
  private readonly catalogs = new Map<string, Record<string, string>>();

  constructor(private readonly config: FormsConfig) {
    if (config.localizationMode !== 'SIMULATED') {
      throw new Cmp009Error('SF-SYS-003', { details: [{ code: 'LOCALIZATION_NOT_SIMULATED' }] });
    }
  }

  put(tenantId: string, locale: string, messages: Record<string, string>): void {
    this.catalogs.set(`${tenantId}|${locale}`, { ...messages });
  }

  async resolve(request: LocalizationResolveRequest): Promise<LocalizationResolveResult> {
    if (!isLocaleTag(request.locale)) {
      throw new Cmp009Error('SF-SYS-003', { details: [{ code: 'LOCALE_INVALID' }] });
    }
    const catalog = this.catalogs.get(`${request.tenantId}|${request.locale}`) ?? {};
    const messages: Record<string, string> = {};
    for (const key of request.keys) {
      if (!MESSAGE_KEY_RE.test(key)) {
        throw new Cmp009Error('SF-SYS-003', { details: [{ code: 'MESSAGE_KEY_INVALID' }] });
      }
      messages[key] = catalog[key] ?? key;
    }
    return {
      locale: request.locale,
      messages,
      simulation: buildSimulationMarker({
        environment: this.config.environment,
        scenario: this.config.scenario,
        testRunId: this.config.testRunId,
        bindingId: this.config.localizationBindingId,
      }),
    };
  }
}

export function wrapLocalizationPort(port: LocalizationPort): LocalizationPort {
  return {
    async resolve(request) {
      try {
        return await port.resolve(request);
      } catch (err) {
        if (err instanceof Cmp009Error) throw err;
        throw new Cmp009Error('SF-SYS-004', {
          details: [{ code: 'LOCALIZATION_UNAVAILABLE' }],
          cause: err,
        });
      }
    },
  };
}
