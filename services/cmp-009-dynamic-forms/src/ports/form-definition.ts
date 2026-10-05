import type { SimulationMarker } from '@serviceform/contracts';
import { buildSimulationMarker, type FormsConfig } from '../config.js';
import { Cmp009Error } from '../errors.js';

export type FormPublicationStatus = 'PUBLISHED' | 'DRAFT' | 'RETIRED';

export interface PublishedFormDefinition {
  tenant_id: string;
  form_key: string;
  version_id: string;
  content_hash: string;
  status: FormPublicationStatus;
  payload: unknown;
  simulation?: SimulationMarker;
}

export interface FormDefinitionRequest {
  tenantId: string;
  formKey: string;
  versionId: string;
  contentHash: string;
  correlationId: string;
}

/**
 * Consumer-side port to published FORM metadata (CMP-050 / CMP-052 pins). Resolved before
 * the authoritative transaction opens; CMP-009 never reads another component's tables.
 */
export interface FormDefinitionPort {
  resolve(request: FormDefinitionRequest): Promise<PublishedFormDefinition>;
}

export class FormDefinitionNotFoundError extends Error {
  constructor() {
    super('form definition not found');
    this.name = 'FormDefinitionNotFoundError';
  }
}

export class DenyFormDefinitionPort implements FormDefinitionPort {
  async resolve(_request: FormDefinitionRequest): Promise<PublishedFormDefinition> {
    throw new Cmp009Error('SF-SYS-004', { details: [{ code: 'FORM_SOURCE_UNAVAILABLE' }] });
  }
}

export class SimulatedFormDefinitionPort implements FormDefinitionPort {
  private readonly forms = new Map<string, PublishedFormDefinition>();

  constructor(private readonly config: FormsConfig) {
    if (config.formSourceMode !== 'SIMULATED') {
      throw new Cmp009Error('SF-SYS-003', { details: [{ code: 'FORM_SOURCE_NOT_SIMULATED' }] });
    }
  }

  publish(form: PublishedFormDefinition): void {
    this.forms.set(this.keyOf(form.tenant_id, form.form_key, form.version_id), form);
  }

  async resolve(request: FormDefinitionRequest): Promise<PublishedFormDefinition> {
    const found = this.forms.get(this.keyOf(request.tenantId, request.formKey, request.versionId));
    if (!found) throw new FormDefinitionNotFoundError();
    return {
      ...found,
      simulation: buildSimulationMarker({
        environment: this.config.environment,
        scenario: this.config.scenario,
        testRunId: this.config.testRunId,
        bindingId: this.config.formSourceBindingId,
      }),
    };
  }

  private keyOf(tenantId: string, formKey: string, versionId: string): string {
    return `${tenantId}|${formKey}|${versionId}`;
  }
}

export function wrapFormDefinitionPort(port: FormDefinitionPort): FormDefinitionPort {
  return {
    async resolve(request) {
      try {
        return await port.resolve(request);
      } catch (err) {
        if (err instanceof Cmp009Error) throw err;
        if (err instanceof FormDefinitionNotFoundError) {
          throw new Cmp009Error('SF-SYS-002', {
            details: [{ code: 'FORM_DEFINITION_NOT_FOUND' }],
            cause: err,
          });
        }
        throw new Cmp009Error('SF-SYS-004', {
          details: [{ code: 'FORM_SOURCE_UNAVAILABLE' }],
          cause: err,
        });
      }
    },
  };
}

export function failingFormDefinitionPort(): FormDefinitionPort {
  return {
    async resolve() {
      throw new Error('form-source-timeout');
    },
  };
}
