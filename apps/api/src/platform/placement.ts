import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

/** SF-CON-PORTAL-PLACEMENT (contracts/m10). Deployment config, never request input (ADR-0007 D-1). */
export interface PortalPlacement {
  portal_id: string;
  surface: 'CITIZEN_PORTAL' | 'OFFICER_WORKBENCH';
  tenant_id: string;
  cell_id: string;
  environment: 'LOCAL' | 'CI' | 'DEVELOPMENT' | 'SIT' | 'UAT';
  environment_label?: 'SAMPLE_LAB';
  offerings: { catalogue_id: string; tenant_service_binding_id: string }[];
  citizen_tenant_derivation: 'PORTAL_PLACEMENT';
  client_tenant_input_accepted: false;
  decision_ref: 'ADR-0007';
}

const SCHEMA_URL = new URL(
  '../../../../contracts/m10/schemas/portal-placement.schema.json',
  import.meta.url,
);
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;

let validator: ((data: unknown) => boolean) | null = null;

function validatePlacement(data: unknown): data is PortalPlacement {
  if (!validator) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    validator = ajv.compile(JSON.parse(readFileSync(SCHEMA_URL, 'utf8')) as object);
  }
  return validator(data);
}

/**
 * Parses and validates a placement. The runtime environment must match the placement, and
 * PREPROD/PRODUCTION are refused until the owner accepts ADR-0007 for production (D-4).
 */
export function parsePlacement(raw: unknown, runtimeEnvironment: string): PortalPlacement {
  if (runtimeEnvironment === 'PRODUCTION' || runtimeEnvironment === 'PREPROD') {
    throw new Error(
      'SF-M10-B: portal-placement citizen context is not accepted for production (ADR-0007 D-4)',
    );
  }
  if (!validatePlacement(raw)) {
    throw new Error('SF-M10-B: portal placement does not satisfy SF-CON-PORTAL-PLACEMENT');
  }
  if (raw.environment !== runtimeEnvironment) {
    throw new Error('SF-M10-B: portal placement environment does not match SF_ENVIRONMENT');
  }
  return raw;
}

export function loadPlacement(path: string, runtimeEnvironment: string): PortalPlacement {
  return parsePlacement(JSON.parse(readFileSync(path, 'utf8')) as unknown, runtimeEnvironment);
}
