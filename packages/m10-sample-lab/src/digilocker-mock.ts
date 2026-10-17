import { randomUUID } from 'node:crypto';
import { PUBLIC_SAMPLE_LAB_POLICY } from './policy';
import { getApplication, updateApplication } from './store';
import type { LabApplication } from './types';

/**
 * SIMULATED DigiLocker publish for SAMPLE_LAB only.
 * Mirrors CMP-012 SimulatedDigiLockerConnector behaviour — no network, no secrets.
 * Must never be treated as PRODUCTION / REAL / G6 clearance.
 */
export function mockDigiLockerPublish(applicationId: string): {
  ok: boolean;
  application?: LabApplication;
  error?: string;
} {
  const app = getApplication(applicationId);
  if (!app) return { ok: false, error: 'SF-LAB-404' };
  if (app.status !== 'ISSUED') {
    return { ok: false, error: 'SF-LAB-NOT_ISSUED' };
  }
  if (!PUBLIC_SAMPLE_LAB_POLICY.digilocker_doc_type.startsWith('SAMPLE_LAB_')) {
    return { ok: false, error: 'SF-LAB-DOC_TYPE' };
  }

  const publishRequestId = randomUUID();
  const testRunId = process.env['SF_M10_LAB_TEST_RUN_ID'] ?? 'local-sample-lab';
  const providerRef = `sim:${publishRequestId}:${testRunId}`;

  const updated = updateApplication(applicationId, {
    digilocker: {
      mode: 'SIMULATED',
      doc_type: PUBLIC_SAMPLE_LAB_POLICY.digilocker_doc_type,
      status: 'PUBLISHED',
      provider_transaction_ref: providerRef,
      simulation_marker: `simulation:digilocker_publish:${testRunId}`,
    },
  });

  if (!updated) return { ok: false, error: 'SF-LAB-404' };
  return { ok: true, application: updated };
}
