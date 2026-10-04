import type { SimulationMarker } from '@serviceform/contracts';
import type { MetadataServiceConfig } from '../config.js';
import { buildMetadataSimulationMarker } from '../config.js';
import {
  isMetadataKind,
  schemaIdForKind,
  validateKindPayload,
  type MetadataKind,
} from '../domain/kinds.js';
import { Cmp033Error } from '../errors.js';

export interface SchemaValidationOk {
  ok: true;
  schema_id: string;
  simulation?: SimulationMarker;
}

export interface SchemaRegistryPort {
  validate(input: {
    kind: string;
    schemaId: string;
    payload: unknown;
  }): Promise<SchemaValidationOk>;
}

export class SimulatedSchemaRegistry implements SchemaRegistryPort {
  constructor(
    private readonly config: MetadataServiceConfig,
    private readonly fail = false,
  ) {}

  async validate(input: {
    kind: string;
    schemaId: string;
    payload: unknown;
  }): Promise<SchemaValidationOk> {
    if (this.fail) {
      throw new Cmp033Error('SF-SYS-004', { details: [{ code: 'SCHEMA_REGISTRY_UNAVAILABLE' }] });
    }
    if (!isMetadataKind(input.kind)) {
      throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'UNKNOWN_KIND' }] });
    }
    const expected = schemaIdForKind(input.kind);
    if (input.schemaId !== expected) {
      throw new Cmp033Error('SF-SYS-003', {
        details: [{ code: 'SCHEMA_ID_MISMATCH', pointer: '/schema_id' }],
      });
    }
    try {
      validateKindPayload(input.kind, input.payload);
    } catch (err) {
      const pointer = (err as { pointer?: string }).pointer;
      throw new Cmp033Error('SF-SYS-003', {
        details: [{ code: 'SCHEMA_INVALID', ...(pointer ? { pointer } : {}) }],
        cause: err,
      });
    }
    const result: SchemaValidationOk = { ok: true, schema_id: expected };
    if (this.config.schemaRegistryMode === 'SIMULATED') {
      result.simulation = buildMetadataSimulationMarker({
        environment: this.config.environment,
        scenario: this.config.scenario,
        testRunId: this.config.testRunId,
        bindingId: this.config.schemaBindingId,
      });
    }
    return result;
  }
}

export function failingSchemaRegistry(config: MetadataServiceConfig): SchemaRegistryPort {
  return new SimulatedSchemaRegistry(config, true);
}

export function wrapSchemaRegistry(port: SchemaRegistryPort): SchemaRegistryPort {
  return {
    async validate(input) {
      try {
        return await port.validate(input);
      } catch (err) {
        if (err instanceof Cmp033Error) throw err;
        throw new Cmp033Error('SF-SYS-004', {
          details: [{ code: 'SCHEMA_REGISTRY_UNAVAILABLE' }],
          cause: err,
        });
      }
    },
  };
}

export type { MetadataKind };
