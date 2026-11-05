import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { COMMANDS } from '@serviceform/cmp-015-application-case';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const M10 = join(ROOT, 'contracts/m10');
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function compile(name: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson(join(M10, 'schemas', `${name}.schema.json`)));
}

const CONTRACTS = ['portal-placement', 'portal-session'] as const;

describe('M10 Phase B journey contracts (SF-CON-PORTAL-PLACEMENT / SF-CON-PORTAL-SESSION)', () => {
  for (const name of CONTRACTS) {
    const check = compile(name);
    const examples = (kind: 'valid' | 'invalid') =>
      readdirSync(join(M10, 'examples', kind)).filter(
        (f) => f === `${name}.json` || f.startsWith(`${name}.`),
      );

    it(`${name}: every valid example passes`, () => {
      const files = examples('valid');
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        expect(check(readJson(join(M10, 'examples/valid', f))), f).toBe(true);
      }
    });

    it(`${name}: every invalid example fails`, () => {
      const files = examples('invalid');
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        expect(check(readJson(join(M10, 'examples/invalid', f))), f).toBe(false);
      }
    });
  }

  it('catalog lists exactly the schemas on disk and both are FROZEN in the lock', () => {
    const catalog = readJson(join(M10, 'catalog.json')) as {
      contracts: { id: string; path: string }[];
    };
    const onDisk = readdirSync(join(M10, 'schemas')).map((f) => `contracts/m10/schemas/${f}`);
    expect(catalog.contracts.map((c) => c.path).sort()).toEqual(onDisk.sort());
    const lock = readFileSync(join(ROOT, 'orchestrator/contracts-lock.yaml'), 'utf8');
    for (const c of catalog.contracts) {
      expect(lock).toContain(`- id: ${c.id}\n    version: 1\n    status: FROZEN\n`);
    }
  });

  it('a placement can never take its tenant from the client', () => {
    const schema = readJson(join(M10, 'schemas/portal-placement.schema.json')) as {
      properties: Record<string, { const?: unknown; enum?: unknown[] }>;
    };
    expect(schema.properties['client_tenant_input_accepted']?.const).toBe(false);
    expect(schema.properties['citizen_tenant_derivation']?.const).toBe('PORTAL_PLACEMENT');
    expect(schema.properties['environment']?.enum).not.toContain('PRODUCTION');
    expect(schema.properties['environment']?.enum).not.toContain('PREPROD');
  });
});

describe('OPA common policy covers every CMP-015 action (ADR-0007 D-2)', () => {
  const common = readJson(join(ROOT, 'policy/opa/sf/common/data.json')) as {
    actions: Record<string, { action_class: string }>;
    resource_types: string[];
    citizen_owner_grants: Record<string, { actions: string[]; assurance: string[] }>;
    citizen_published_grants: Record<string, { actions: string[]; assurance: string[] }>;
  };

  it('every CMP-015 command maps to a known APPLICATION_* action', () => {
    for (const command of COMMANDS) {
      expect(common.actions[`APPLICATION_${command}`], command).toBeDefined();
    }
    expect(common.resource_types).toContain('ApplicationCase');
  });

  it('citizen-owner grants are known actions and exclude officer decisions', () => {
    const grant = common.citizen_owner_grants['ApplicationCase'];
    expect(grant).toBeDefined();
    for (const action of grant?.actions ?? []) expect(common.actions[action], action).toBeDefined();
    for (const forbidden of [
      'APPLICATION_RECORD_APPROVED',
      'APPLICATION_RECORD_REJECTED',
      'APPLICATION_RECORD_ISSUED',
      'APPLICATION_MARK_RECEIVED',
      'APPLICATION_ENTER_SCRUTINY',
      'APPLICATION_COMMIT_WITHDRAWAL',
      'APPLICATION_COMMIT_CANCELLATION',
    ]) {
      expect(grant?.actions).not.toContain(forbidden);
    }
    expect(grant?.assurance).not.toContain('NONE');
  });

  it('CMP-009 citizen grants are limited to interpreting and validating (CCR-M10-002)', () => {
    expect(common.resource_types).toEqual(
      expect.arrayContaining(['FormDefinition', 'FormExecution']),
    );
    expect(common.citizen_owner_grants['FormExecution']?.actions).toEqual([
      'FORM_EXECUTION_EXECUTE',
    ]);
    expect(common.citizen_published_grants).toEqual({
      FormDefinition: { actions: ['FORM_INTERPRET'], assurance: ['OTP', 'MFA'] },
    });
    for (const action of ['FORM_INTERPRET', 'FORM_EXECUTION_EXECUTE', 'FORM_EXECUTION_READ']) {
      expect(common.actions[action], action).toBeDefined();
    }
  });

  it('bundle manifest revision matches the policy revision returned in decisions', () => {
    const manifest = readJson(join(ROOT, 'policy/opa/.manifest')) as { revision: string };
    const meta = readJson(join(ROOT, 'policy/opa/sf/meta/data.json')) as {
      policy_revision: string;
    };
    expect(manifest.revision).toBe(meta.policy_revision);
  });
});
