import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { assertSimulatorEnvironment } from './simulators.js';

/**
 * SAMPLE_LAB TSB immutability seal engineering (SF-60).
 * Lab prove path: verify PUBLISHED pin-graph hash + mutation refusal.
 * Does not mutate CMP-052 published rows. Does not claim G6/CERTIFIED.
 * Catalogue mirrors packages/m10-sample-lab + fixtures/lab/platform/tsb-seal-catalogue.json.
 * G6 gate `tsb_immutability_sealed` stays false (owner/REAL DigiLocker).
 */

/** Linear UUID check — avoids njsscan regex_dos on user-supplied ids. */
function isHexChar(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
}

function isUuid(value: string): boolean {
  if (value.length !== 36) return false;
  for (let i = 0; i < 36; i++) {
    const c = value.charCodeAt(i);
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      if (c !== 45) return false;
      continue;
    }
    if (!isHexChar(c)) return false;
  }
  const version = value.charCodeAt(14);
  if (version < 49 || version > 56) return false;
  const variant = value.charAt(19).toLowerCase();
  return variant === '8' || variant === '9' || variant === 'a' || variant === 'b';
}

export const TSB_SEAL_PIN_KEYS = [
  'service',
  'offering',
  'form',
  'rules',
  'evidence',
  'fee',
  'workflow',
  'sla',
  'access',
  'credential',
  'notification',
  'authorization_policy',
] as const;

export type TsbSealPinKey = (typeof TSB_SEAL_PIN_KEYS)[number];
export type TsbSealPinRef = { version_ref: string; content_hash: string };
export type TsbSealPinMap = Record<TsbSealPinKey, TsbSealPinRef>;

export type LabTsbSealTarget = {
  catalogue_id: string;
  tenant_id: string;
  tenant_service_binding_id: string;
  binding_key: string;
  offering_ref: string;
  metadata_bundle_ref: string;
  status: 'PUBLISHED';
  pins: TsbSealPinMap;
  artifact_hash: string;
  label: string;
};

export type LabTsbSealCatalogue = {
  source: string;
  policy_kind: string;
  test_run_id: string;
  mode: 'SAMPLE_LAB';
  certified: false;
  g6: false;
  tsb_immutability_sealed: false;
  production_digilocker_ready: false;
  production_dlt_ready: false;
  targets: LabTsbSealTarget[];
};

export type LabTsbSealAttestation = {
  lab_eng_sealed: boolean;
  sealed_at: string | null;
  binding_id: string;
  catalogue_id: string;
  artifact_hash: string;
  hash_verified: boolean;
  mutation_refused: boolean;
  status: string;
  mode: 'SAMPLE_LAB';
  tsb_immutability_sealed: false;
  certified: false;
  g6: false;
  production_digilocker_ready: false;
  production_dlt_ready: false;
  reason_codes: string[];
};

export type LabTsbSealStore = Map<string, LabTsbSealAttestation>;

export const LAB_TSB_SEAL_DEFAULTS = {
  source: 'SAMPLE_LAB',
  test_run_id: 'sample-lab-tsb-seal',
  tenant_id: '0d15ba00-0001-4000-8000-0d15ba0000d1',
  tenant_service_binding_id: '0d15ba00-0002-4000-8000-0d15ba0000d2',
  binding_key: 'ind-soc-002.sample-lab',
  offering_ref: 'IND-SOC-002',
  metadata_bundle_ref: 'bundle.ind-soc-002.sample-lab.v1',
  pin_content_hash: 'sha256:abababababababababababababababababababababababababababababababab',
  artifact_hash: 'sha256:62ac3e74e877b0c045cedcf10d34c4b253dcc6f2c98cd187e37cfb72fea3f4af',
} as const;

function sha256Fingerprint(parts: readonly string[]): string {
  return `sha256:${createHash('sha256').update(parts.join('|'), 'utf8').digest('hex')}`;
}

/** Mirrors CMP-052 `artifactHash`. */
export function labArtifactHash(input: {
  binding_key: string;
  offering_ref: string;
  metadata_bundle_ref: string;
  pins: TsbSealPinMap;
}): string {
  const graph = TSB_SEAL_PIN_KEYS.map(
    (kind) => `${kind}:${input.pins[kind].version_ref}:${input.pins[kind].content_hash}`,
  ).join(',');
  return sha256Fingerprint([
    input.binding_key,
    input.offering_ref,
    input.metadata_bundle_ref,
    graph,
  ]);
}

export function sampleLabResidencePins(): TsbSealPinMap {
  const hash = LAB_TSB_SEAL_DEFAULTS.pin_content_hash;
  const pins = {} as TsbSealPinMap;
  for (const key of TSB_SEAL_PIN_KEYS) {
    pins[key] = {
      version_ref: `ind-soc-002-${key}-v1@0.2.0-sample-lab`,
      content_hash: hash,
    };
  }
  return pins;
}

export const LAB_TSB_SEAL_CATALOGUE: LabTsbSealCatalogue = {
  source: 'SAMPLE_LAB',
  policy_kind: 'SAMPLE_LAB_ENG_SEAL',
  test_run_id: LAB_TSB_SEAL_DEFAULTS.test_run_id,
  mode: 'SAMPLE_LAB',
  certified: false,
  g6: false,
  tsb_immutability_sealed: false,
  production_digilocker_ready: false,
  production_dlt_ready: false,
  targets: [
    {
      catalogue_id: 'IND-SOC-002',
      tenant_id: LAB_TSB_SEAL_DEFAULTS.tenant_id,
      tenant_service_binding_id: LAB_TSB_SEAL_DEFAULTS.tenant_service_binding_id,
      binding_key: LAB_TSB_SEAL_DEFAULTS.binding_key,
      offering_ref: LAB_TSB_SEAL_DEFAULTS.offering_ref,
      metadata_bundle_ref: LAB_TSB_SEAL_DEFAULTS.metadata_bundle_ref,
      status: 'PUBLISHED',
      pins: sampleLabResidencePins(),
      artifact_hash: LAB_TSB_SEAL_DEFAULTS.artifact_hash,
      label: 'SAMPLE_LAB eng seal · Residence Certificate (IND-SOC-002)',
    },
  ],
};

export function isSampleLabSealEnvironment(environment: string): boolean {
  return environment === 'LOCAL' || environment === 'CI';
}

export function proveLabTsbEngSeal(input: {
  environment: string;
  source?: string;
  now?: string;
  binding: {
    binding_id: string;
    catalogue_id?: string;
    binding_key: string;
    offering_ref: string;
    metadata_bundle_ref: string;
    status: string;
    pins: TsbSealPinMap;
    artifact_hash: string;
  };
}): LabTsbSealAttestation {
  const reasons: string[] = [];
  const source = input.source ?? 'SAMPLE_LAB';
  if (source !== 'SAMPLE_LAB') reasons.push('SOURCE_NOT_SAMPLE_LAB');
  if (!isSampleLabSealEnvironment(input.environment)) reasons.push('ENV_NOT_LAB');
  if (input.binding.status !== 'PUBLISHED') reasons.push('NOT_PUBLISHED');

  let hashVerified = false;
  try {
    const recomputed = labArtifactHash({
      binding_key: input.binding.binding_key,
      offering_ref: input.binding.offering_ref,
      metadata_bundle_ref: input.binding.metadata_bundle_ref,
      pins: input.binding.pins,
    });
    hashVerified = recomputed === input.binding.artifact_hash;
    if (!hashVerified) reasons.push('HASH_MISMATCH');
  } catch {
    reasons.push('HASH_COMPUTE_FAILED');
  }

  const mutationRefused = input.binding.status === 'PUBLISHED';
  if (!mutationRefused) reasons.push('MUTATION_GATE_OPEN');

  const ok = reasons.length === 0 && hashVerified && mutationRefused;
  return {
    lab_eng_sealed: ok,
    sealed_at: ok ? (input.now ?? new Date().toISOString()) : null,
    binding_id: input.binding.binding_id,
    catalogue_id: input.binding.catalogue_id ?? input.binding.offering_ref,
    artifact_hash: input.binding.artifact_hash,
    hash_verified: hashVerified,
    mutation_refused: mutationRefused,
    status: input.binding.status,
    mode: 'SAMPLE_LAB',
    tsb_immutability_sealed: false,
    certified: false,
    g6: false,
    production_digilocker_ready: false,
    production_dlt_ready: false,
    reason_codes: reasons,
  };
}

export function parseTsbSealCatalogue(raw: unknown): LabTsbSealCatalogue {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const targetsRaw = Array.isArray(obj['targets']) ? obj['targets'] : [];
  const targets: LabTsbSealTarget[] = [];
  for (const entry of targetsRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const t = entry as Record<string, unknown>;
    const catalogue_id = typeof t['catalogue_id'] === 'string' ? t['catalogue_id'] : '';
    const tenant_id = typeof t['tenant_id'] === 'string' ? t['tenant_id'] : '';
    const tenant_service_binding_id =
      typeof t['tenant_service_binding_id'] === 'string' ? t['tenant_service_binding_id'] : '';
    const binding_key = typeof t['binding_key'] === 'string' ? t['binding_key'] : '';
    const offering_ref = typeof t['offering_ref'] === 'string' ? t['offering_ref'] : '';
    const metadata_bundle_ref =
      typeof t['metadata_bundle_ref'] === 'string' ? t['metadata_bundle_ref'] : '';
    const artifact_hash = typeof t['artifact_hash'] === 'string' ? t['artifact_hash'] : '';
    const pins = t['pins'];
    if (
      !catalogue_id ||
      !isUuid(tenant_id) ||
      !isUuid(tenant_service_binding_id) ||
      !binding_key ||
      !offering_ref ||
      !metadata_bundle_ref ||
      !artifact_hash ||
      !pins ||
      typeof pins !== 'object'
    ) {
      continue;
    }
    targets.push({
      catalogue_id,
      tenant_id,
      tenant_service_binding_id,
      binding_key,
      offering_ref,
      metadata_bundle_ref,
      status: 'PUBLISHED',
      pins: pins as TsbSealPinMap,
      artifact_hash,
      label: typeof t['label'] === 'string' ? t['label'] : catalogue_id,
    });
  }
  if (targets.length === 0) return LAB_TSB_SEAL_CATALOGUE;
  return {
    source: 'SAMPLE_LAB',
    policy_kind: 'SAMPLE_LAB_ENG_SEAL',
    test_run_id:
      typeof obj['test_run_id'] === 'string'
        ? obj['test_run_id']
        : LAB_TSB_SEAL_DEFAULTS.test_run_id,
    mode: 'SAMPLE_LAB',
    certified: false,
    g6: false,
    tsb_immutability_sealed: false,
    production_digilocker_ready: false,
    production_dlt_ready: false,
    targets,
  };
}

export function loadTsbSealCatalogue(dir: string): LabTsbSealCatalogue {
  try {
    return parseTsbSealCatalogue(
      JSON.parse(readFileSync(join(dir, 'tsb-seal-catalogue.json'), 'utf8')) as unknown,
    );
  } catch {
    return LAB_TSB_SEAL_CATALOGUE;
  }
}

export function targetForBinding(
  catalogue: LabTsbSealCatalogue,
  bindingId: string,
): LabTsbSealTarget | null {
  return catalogue.targets.find((t) => t.tenant_service_binding_id === bindingId) ?? null;
}

type PublishedSealRow = {
  binding_id: string;
  binding_key: string;
  offering_ref: string;
  metadata_bundle_ref: string;
  status: string;
  pins: TsbSealPinMap;
  artifact_hash: string;
};

async function readPublishedBinding(
  pool: pg.Pool | undefined,
  tenantId: string,
  bindingId: string,
): Promise<PublishedSealRow | null> {
  if (!pool || !isUuid(tenantId) || !isUuid(bindingId)) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const res = await client.query<PublishedSealRow>(
      `SELECT binding_id, binding_key, offering_ref, metadata_bundle_ref, status, pins, artifact_hash
         FROM sf_versioning.tenant_service_binding
        WHERE tenant_id = $1 AND binding_id = $2`,
      [tenantId, bindingId],
    );
    await client.query('COMMIT');
    return res.rows[0] ?? null;
  } catch {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    return null;
  } finally {
    client.release();
  }
}

function bindingFromTarget(target: LabTsbSealTarget): PublishedSealRow {
  return {
    binding_id: target.tenant_service_binding_id,
    binding_key: target.binding_key,
    offering_ref: target.offering_ref,
    metadata_bundle_ref: target.metadata_bundle_ref,
    status: target.status,
    pins: target.pins,
    artifact_hash: target.artifact_hash,
  };
}

export function resolveSealSubject(params: {
  catalogue: LabTsbSealCatalogue;
  bindingId?: string;
  catalogueId?: string;
  dbRow?: PublishedSealRow | null;
}): { row: PublishedSealRow; catalogue_id: string } | null {
  if (params.dbRow && params.dbRow.status === 'PUBLISHED') {
    return {
      row: params.dbRow,
      catalogue_id: params.catalogueId ?? params.dbRow.offering_ref,
    };
  }
  const target = params.bindingId
    ? targetForBinding(params.catalogue, params.bindingId)
    : (params.catalogue.targets[0] ?? null);
  if (!target) return null;
  return { row: bindingFromTarget(target), catalogue_id: target.catalogue_id };
}

export function createLabTsbSealStore(): LabTsbSealStore {
  return new Map();
}

/**
 * Lab routes (not frozen OpenAPI — no CCR):
 * - GET  /v1/lab/tsb-seal/catalogue
 * - GET  /v1/lab/tsb-seal/:bindingId
 * - POST /v1/lab/tsb-seal/:bindingId/prove
 */
export function registerLabTsbSealRoutes(
  app: FastifyInstance,
  opts: {
    environment: string;
    catalogue: LabTsbSealCatalogue;
    store: LabTsbSealStore;
    pool?: pg.Pool;
    defaultTenantId?: string;
  },
): void {
  assertSimulatorEnvironment(opts.environment);

  app.get('/v1/lab/tsb-seal/catalogue', async (_req, reply) => {
    return reply.header('cache-control', 'no-store').send({
      source: 'SAMPLE_LAB',
      certified: false,
      g6_issued: false,
      tsb_immutability_sealed: false,
      lab_eng_seal_available: true,
      catalogue: opts.catalogue,
    });
  });

  app.get<{ Params: { bindingId: string } }>('/v1/lab/tsb-seal/:bindingId', async (req, reply) => {
    const bindingId = req.params.bindingId;
    const existing = opts.store.get(bindingId);
    return reply.header('cache-control', 'no-store').send({
      binding_id: bindingId,
      lab_eng_sealed: existing?.lab_eng_sealed ?? false,
      attestation: existing ?? null,
      tsb_immutability_sealed: false,
      certified: false,
      g6_issued: false,
    });
  });

  app.post<{
    Params: { bindingId: string };
    Body: { tenant_id?: string; catalogue_id?: string };
  }>('/v1/lab/tsb-seal/:bindingId/prove', async (req, reply) => {
    const bindingId = req.params.bindingId;
    const tenantId =
      typeof req.body?.tenant_id === 'string' && isUuid(req.body.tenant_id)
        ? req.body.tenant_id
        : (opts.defaultTenantId ?? LAB_TSB_SEAL_DEFAULTS.tenant_id);
    const catalogueId =
      typeof req.body?.catalogue_id === 'string' ? req.body.catalogue_id : undefined;

    const dbRow = await readPublishedBinding(opts.pool, tenantId, bindingId);
    const subject = resolveSealSubject({
      catalogue: opts.catalogue,
      bindingId,
      ...(catalogueId ? { catalogueId } : {}),
      dbRow,
    });
    if (!subject) {
      return reply.code(404).header('cache-control', 'no-store').send({
        error_code: 'SF-APP-001',
        message: 'TSB seal subject not found',
        certified: false,
        g6_issued: false,
        tsb_immutability_sealed: false,
      });
    }

    const attestation = proveLabTsbEngSeal({
      environment: opts.environment,
      source: 'SAMPLE_LAB',
      binding: {
        binding_id: subject.row.binding_id,
        catalogue_id: subject.catalogue_id,
        binding_key: subject.row.binding_key,
        offering_ref: subject.row.offering_ref,
        metadata_bundle_ref: subject.row.metadata_bundle_ref,
        status: subject.row.status,
        pins: subject.row.pins,
        artifact_hash: subject.row.artifact_hash,
      },
    });

    if (attestation.lab_eng_sealed) {
      opts.store.set(bindingId, attestation);
    }

    return reply
      .code(attestation.lab_eng_sealed ? 200 : 400)
      .header('cache-control', 'no-store')
      .send({
        ...attestation,
        g6_issued: false,
        note: 'Lab eng seal only. Owner still owns human G6 seal claim.',
      });
  });
}
