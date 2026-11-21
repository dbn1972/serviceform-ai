import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LabCaseCommandPort } from '../src/platform/deficiency.js';

const ROOT = join(import.meta.dirname, '../../..');
const FIXTURE = join(ROOT, 'fixtures/lab/platform/deficiency-catalogue.json');
const PACKAGE_SRC = join(
  ROOT,
  'packages/m10-sample-lab/src/deficiency-catalogue.ts',
);

// REQ SF-47: lab fixture and m10-sample-lab catalogue stay aligned; CaseCommandPort is host-only.
describe('SAMPLE_LAB deficiency host adapters', () => {
  it('publishes reason/item codes in the lab fixture and package source', () => {
    const file = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
      reasons: { reason_code: string }[];
      item_codes: { item_code: string }[];
    };
    const src = readFileSync(PACKAGE_SRC, 'utf8');
    expect(file.reasons.map((r) => r.reason_code)).toEqual([
      'MISSING_PROOF',
      'ADDRESS_MISMATCH',
    ]);
    expect(file.item_codes.some((i) => i.item_code === 'ELECTRICITY_BILL')).toBe(true);
    for (const code of file.reasons.map((r) => r.reason_code)) {
      expect(src).toContain(`reason_code: '${code}'`);
    }
    expect(src).toContain("item_code: 'ELECTRICITY_BILL'");
  });

  it('maps CMP-015 success bodies through LabCaseCommandPort', async () => {
    const port = new LabCaseCommandPort({
      getApplication: async () => ({ status: 500, body: {} }),
      listTransitions: async () => ({ status: 500, body: {} }),
      executeCommand: async () => ({
        status: 200,
        body: {
          application: {
            application_id: '0d15ba00-0a00-4000-8000-0d15ba000a01',
            state: 'DEFICIENCY_RAISED',
            aggregate_version: 4,
          },
        },
      }),
    });
    const result = await port.executeCommand(
      {
        tenant_id: '0d15ba00-0001-4000-8000-0d15ba0000d1',
        cell_id: 'cell',
        actor: { type: 'OFFICER', id: '0d15ba00-0ff1-4000-8000-0d15ba000ff1' },
        roles: ['SAMPLE_LAB_CASE_OFFICER'],
        jurisdiction_ids: [],
        auth_assurance: 'MFA',
        correlation_id: '0d15ba00-0c01-4000-8000-0d15ba000c01',
        trace_id: '0d15ba000c010d15ba000c010d15ba00',
      },
      '0d15ba00-0a00-4000-8000-0d15ba000a01',
      {
        command: 'RAISE_DEFICIENCY',
        expected_state: 'UNDER_SCRUTINY',
        expected_version: 3,
        reason_code: 'MISSING_PROOF',
      },
      'idem-1',
    );
    expect(result).toEqual({
      application_id: '0d15ba00-0a00-4000-8000-0d15ba000a01',
      state: 'DEFICIENCY_RAISED',
      aggregate_version: 4,
    });
  });

  it('surfaces CMP-015 failures with detail codes for the reconciler', async () => {
    const port = new LabCaseCommandPort({
      getApplication: async () => ({ status: 500, body: {} }),
      listTransitions: async () => ({ status: 500, body: {} }),
      executeCommand: async () => ({
        status: 409,
        body: {
          error_code: 'SF-APP-001',
          message: 'stale',
          details: [{ code: 'STALE_VERSION', pointer: '/expected_version' }],
        },
      }),
    });
    await expect(
      port.executeCommand(
        {
          tenant_id: '0d15ba00-0001-4000-8000-0d15ba0000d1',
          cell_id: 'cell',
          actor: { type: 'OFFICER', id: '0d15ba00-0ff1-4000-8000-0d15ba000ff1' },
          roles: [],
          jurisdiction_ids: [],
          auth_assurance: 'MFA',
          correlation_id: '0d15ba00-0c01-4000-8000-0d15ba000c01',
          trace_id: '0d15ba000c010d15ba000c010d15ba00',
        },
        '0d15ba00-0a00-4000-8000-0d15ba000a01',
        {
          command: 'RECORD_CITIZEN_RESPONSE',
          expected_state: 'DEFICIENCY_RAISED',
          expected_version: 4,
          reason_code: null,
        },
        'idem-2',
      ),
    ).rejects.toMatchObject({
      code: 'SF-APP-001',
      details: [{ code: 'STALE_VERSION' }],
    });
  });
});
