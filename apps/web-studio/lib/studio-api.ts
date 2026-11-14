/**
 * Browser calls to the Studio BFF (`/api/platform/*`), which forwards the CMP-004 bearer to
 * CMP-033 metadata, CMP-009 forms, CMP-008 rules (test bench), CMP-016 workflow authoring,
 * CMP-051 maker-checker and CMP-052 versioning. The BFF decides nothing: OPA authorises,
 * PostgreSQL RLS isolates and each component owns its state.
 */

export interface ApiError {
  status: number;
  code: string;
  details: { code?: string; pointer?: string }[];
}

export type ApiResult<T> = { ok: true; body: T } | { ok: false; error: ApiError };

export interface MetadataDocument {
  document_id: string;
  document_key: string;
  kind: string;
  payload: unknown;
  payload_hash: string;
  status: 'DRAFT' | 'VALIDATED' | 'COMPOSED' | 'PUBLISHED';
  aggregate_version: number;
}

export interface Interpretation {
  form: { form_key: string; version_id: string; content_hash: string };
  locale: string;
  controls: { scope: string; renderer_id: string; required: boolean; visible: boolean }[];
  visible_fields: string[];
  required_fields: string[];
  renderer_ids: string[];
  client_validation_authoritative: boolean;
}

export interface Pin {
  version_ref: string;
  content_hash: string;
}

export interface Binding {
  binding_id: string;
  binding_key: string;
  offering_ref: string;
  metadata_bundle_ref: string;
  pins: Record<string, Pin>;
  artifact_hash: string;
  status: string;
  published_version_id: string | null;
}

export interface PublicationRequest {
  request_id: string;
  subject_id: string;
  proposed_hash: string;
  status: string;
  maker_principal_id: string;
  checker_principal_id: string | null;
  ai_advisory?: { skipped?: boolean; codes?: string[] };
}

/** CMP-052 pin kinds in their canonical order (TenantServiceBinding dependency graph). */
export const PIN_ORDER = [
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

export function orderedPins(pins: Record<string, Pin>): [string, Pin][] {
  const rank = (k: string) => {
    const i = (PIN_ORDER as readonly string[]).indexOf(k);
    return i < 0 ? PIN_ORDER.length : i;
  };
  return Object.entries(pins).sort(([a], [b]) => rank(a) - rank(b));
}

export interface SessionState {
  authenticated: boolean;
  actor_id: string | null;
}

async function call<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    headers['Idempotency-Key'] = crypto.randomUUID();
  }
  let res: Response;
  try {
    res = await fetch(`/api/platform/${path}`, {
      method,
      headers,
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    });
  } catch {
    return { ok: false, error: { status: 0, code: 'SF-SYS-004', details: [] } };
  }
  const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      error: {
        status: res.status,
        code: typeof parsed['error_code'] === 'string' ? parsed['error_code'] : 'SF-SYS-004',
        details: Array.isArray(parsed['details']) ? (parsed['details'] as ApiError['details']) : [],
      },
    };
  }
  return { ok: true, body: parsed as T };
}

export async function readSession(): Promise<SessionState> {
  try {
    const res = await fetch('/api/session', { cache: 'no-store' });
    if (!res.ok) return { authenticated: false, actor_id: null };
    const body = (await res.json()) as { authenticated?: boolean; actor_id?: string | null };
    return { authenticated: body.authenticated === true, actor_id: body.actor_id ?? null };
  } catch {
    return { authenticated: false, actor_id: null };
  }
}

export const metadataApi = {
  create: (kind: string, documentKey: string, payload: unknown) =>
    call<MetadataDocument>('POST', 'metadata/documents', {
      kind,
      document_key: documentKey,
      payload,
    }),
  read: (id: string) => call<MetadataDocument>('GET', `metadata/documents/${id}`),
  patch: (id: string, payload: unknown) =>
    call<MetadataDocument>('PATCH', `metadata/documents/${id}`, { payload }),
  validate: (id: string) => call<MetadataDocument>('POST', `metadata/documents/${id}/validate`),
  publish: (id: string) => call<MetadataDocument>('POST', `metadata/documents/${id}/publish`),
};

export const formsApi = {
  interpret: (pin: { form_key: string; version_id: string; content_hash: string }) =>
    call<Interpretation>('POST', 'interpretations', { form: pin, data: {}, locale: 'en-IN' }),
};

export interface GraphCheck {
  valid: true;
  graph_hash: string;
  node_count: number;
  edge_count: number;
  bpmn_xml: string;
  runtime: 'TEMPORAL';
  bpmn_role: 'IMPORT_EXPORT_PROFILE_ONLY';
}

export interface WorkflowDraft {
  definition_id: string;
  version_id: string;
  version_no: number;
  status: 'DRAFT';
  origin: 'STUDIO' | 'BPMN_IMPORT';
  graph_hash: string;
  source_ref?: string;
}

export const workflowApi = {
  check: (graph: unknown, versionRef?: string) =>
    call<GraphCheck>('POST', 'workflow-graphs/check', {
      graph,
      ...(versionRef ? { version_ref: versionRef } : {}),
    }),
  importBpmn: (xml: string) =>
    call<{
      graph: { nodes: unknown[]; edges: unknown[] };
      graph_hash: string;
      source_graph_hash?: string;
    }>('POST', 'workflow-graphs/import-bpmn', { xml }),
  emitDraft: (input: {
    definition_key: string;
    graph: unknown;
    graph_hash: string;
    source_ref?: string;
  }) => call<WorkflowDraft>('POST', 'workflow-drafts', input),
  /** Publish a DRAFT after CMP-051 approval (`approval_ref` = publication request id). */
  publish: (versionId: string, approvalRef: string) =>
    call<WorkflowDraft & { status: 'PUBLISHED' }>('POST', 'workflow-versions/publish', {
      version_id: versionId,
      approval_ref: approvalRef,
    }),
};

export interface RuleTestCaseInput {
  id: string;
  inputs: Record<string, unknown>;
  expect_outcome?: string;
  expect_reasons?: string[];
}

export interface RuleTestResult {
  id: string;
  pass: boolean;
  outcome?: string | null;
  reason_codes?: string[];
  matched_rules?: string[];
  result_code?: 'RULE_OUTPUT_PRODUCED' | 'NO_RULE_OUTPUT';
  error?: string;
}

/** CMP-008 test bench response: advisory rule outputs, nothing stored. */
export interface RuleTestRun {
  pack_key: string;
  content_hash: string;
  engine: { name: string; version: string };
  advisory: true;
  passed: number;
  failed: number;
  results: RuleTestResult[];
}

export const rulesApi = {
  test: (pack: unknown, cases: RuleTestCaseInput[]) =>
    call<RuleTestRun>('POST', 'rule-packs/test', { pack, cases }),
};

export const bindingsApi = {
  read: (id: string) => call<Binding>('GET', `tenant-service-bindings/${id}`),
  create: (input: {
    binding_key: string;
    offering_ref: string;
    metadata_bundle_ref: string;
    pins: Record<string, Pin>;
  }) => call<Binding>('POST', 'tenant-service-bindings', input),
  publish: (id: string) => call<Binding>('POST', `tenant-service-bindings/${id}/publish`),
};

export const publicationApi = {
  create: (subjectId: string, proposedHash: string) =>
    call<PublicationRequest>('POST', 'publication-requests', {
      subject_id: subjectId,
      proposed_hash: proposedHash,
    }),
  read: (id: string) => call<PublicationRequest>('GET', `publication-requests/${id}`),
  submit: (id: string, reason: string) =>
    call<PublicationRequest>('POST', `publication-requests/${id}/submit`, { reason }),
  decide: (id: string, decision: 'approve' | 'reject', reason: string) =>
    call<PublicationRequest>('POST', `publication-requests/${id}/${decision}`, { reason }),
};

const MESSAGES: Record<string, string> = {
  'SF-AUTH-001': 'Sign in on the Session page first (SIMULATED Studio officer).',
  'SF-AUTH-002': 'Your Studio role is not allowed to do this, or you made this request yourself.',
  'SF-TEN-002': 'Request refused: tenant context comes only from your session.',
  'SF-SYS-002': 'The platform host is not running this component.',
  'SF-SYS-003': 'The platform refused the content.',
  'SF-SYS-004': 'The platform host is not reachable.',
  'SF-APP-001': 'Not found for your tenant.',
  'SF-APP-002': 'A document with this key and version already exists. Change the version.',
  'SF-FORM-001': 'The pin does not match a published form (key, version or content hash).',
  'SF-FORM-002': 'CMP-009 could not parse the form package.',
  'SF-WF-001': 'CMP-016 refused the workflow transition or change.',
  'SF-RULE-001': 'CMP-008 could not evaluate the rule pack.',
};

/** Plain-language explanation of a platform error, with the stable code and detail codes. */
export function explain(error: ApiError): string {
  const detail = error.details
    .map((d) => [d.code, d.pointer].filter(Boolean).join(' at '))
    .filter(Boolean)
    .join('; ');
  const base = MESSAGES[error.code] ?? 'The platform returned an error.';
  return `${base} (${error.code}${detail ? ` · ${detail}` : ''})`;
}
