import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ODISHA_LAB_POLICY } from './policy';
import type { LabApplication, LabStoreFile } from './types';

/** Fixed SAMPLE_LAB path under /tmp — shared by citizen + officer Next apps. */
const DEFAULT_DIR = '/tmp';
const DEFAULT_FILE = 'sf-m10-ind-soc-002-lab.json';

export function labStorePath(): string {
  return process.env['SF_M10_LAB_STORE_PATH'] ?? join(DEFAULT_DIR, DEFAULT_FILE);
}

function emptyStore(): LabStoreFile {
  return {
    version: 1,
    label: 'SAMPLE_LAB',
    g6_issued: false,
    applications: [],
  };
}

export function readLabStore(): LabStoreFile {
  const path = labStorePath();
  if (!existsSync(/*turbopackIgnore: true*/ path)) return emptyStore();
  try {
    const raw = readFileSync(/*turbopackIgnore: true*/ path, 'utf8');
    const parsed = JSON.parse(raw) as LabStoreFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.applications)) return emptyStore();
    return parsed;
  } catch {
    return emptyStore();
  }
}

export function writeLabStore(store: LabStoreFile): void {
  const path = labStorePath();
  mkdirSync(/*turbopackIgnore: true*/ dirname(path), { recursive: true });
  const next: LabStoreFile = {
    ...store,
    label: 'SAMPLE_LAB',
    g6_issued: false,
  };
  writeFileSync(/*turbopackIgnore: true*/ path, JSON.stringify(next, null, 2), 'utf8');
}

export function listApplications(): LabApplication[] {
  return readLabStore().applications;
}

export function getApplication(id: string): LabApplication | undefined {
  return listApplications().find((a) => a.id === id);
}

export function createApplication(
  input: Omit<
    LabApplication,
    | 'id'
    | 'catalogue_id'
    | 'status'
    | 'created_at'
    | 'updated_at'
    | 'fee_paisa'
    | 'eligibility_pass'
    | 'digilocker'
    | 'credential_id'
    | 'rejection_reason'
  >,
): LabApplication {
  const now = new Date().toISOString();
  const eligibility_pass =
    input.residence_duration_months >= ODISHA_LAB_POLICY.min_residence_months;
  const app: LabApplication = {
    id: randomUUID(),
    catalogue_id: 'IND-SOC-002',
    status: 'SUBMITTED',
    created_at: now,
    updated_at: now,
    ...input,
    fee_paisa: ODISHA_LAB_POLICY.fee_amount_paisa,
    eligibility_pass,
    digilocker: {
      mode: 'SIMULATED',
      doc_type: ODISHA_LAB_POLICY.digilocker_doc_type,
      status: 'NOT_REQUESTED',
      simulation_marker: `sim:pending:${ODISHA_LAB_POLICY.environment_label}`,
    },
  };
  const store = readLabStore();
  store.applications.unshift(app);
  writeLabStore(store);
  return app;
}

export function updateApplication(
  id: string,
  patch: Partial<LabApplication>,
): LabApplication | undefined {
  const store = readLabStore();
  const idx = store.applications.findIndex((a) => a.id === id);
  if (idx < 0) return undefined;
  const current = store.applications[idx]!;
  const next: LabApplication = {
    ...current,
    ...patch,
    id: current.id,
    catalogue_id: 'IND-SOC-002',
    updated_at: new Date().toISOString(),
    digilocker: patch.digilocker ?? current.digilocker,
  };
  store.applications[idx] = next;
  writeLabStore(store);
  return next;
}
