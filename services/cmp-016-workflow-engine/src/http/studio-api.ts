import { exportBpmn, importBpmn } from '../bpmn/profile.js';
import { Cmp016Error, invalid } from '../errors.js';
import { graphHash, sha256 } from '../domain/hash.js';
import { isUuid, type WorkflowGraph } from '../domain/model.js';
import { parseGraph, toCanonicalModel } from '../domain/validate.js';
import type { WorkflowVersionRecord } from '../domain/versioning.js';
import type { AuthorizationPort, WorkflowAction, WorkflowContext } from '../ports.js';

/**
 * Studio-facing CMP-016 API (SF-M10-C-2), framework-neutral like the M07 component APIs: the host
 * maps HTTP to these handlers. It checks and converts canonical graphs (BPMN import/export is the
 * interoperability profile only; nothing here executes BPMN) and emits Studio drafts through the
 * WorkflowService, so every write keeps CMP-016's validation, RLS, audit and immutability.
 * Publication stays maker-checker approved (WorkflowService.publish + ApprovalPort).
 */

export interface StudioCaller extends WorkflowContext {
  roles: readonly string[];
  jurisdiction_ids?: readonly string[];
  assurance?: string;
}

export interface StudioDraftService {
  createDefinition(
    ctx: WorkflowContext,
    input: { definition_key: string },
  ): Promise<{ definition_id: string }>;
  createDraft(
    ctx: WorkflowContext,
    input: { definition_id: string; graph: unknown },
  ): Promise<WorkflowVersionRecord>;
  exportBpmn(ctx: WorkflowContext, versionId: string): Promise<string>;
}

export interface StudioWorkflowApiDeps {
  /** OPA decision for the caller (roles from the CMP-004 session); deny by default. */
  authorize(
    caller: StudioCaller,
    action: WorkflowAction,
    resource: { type: string; id?: string },
  ): Promise<boolean>;
  /** A WorkflowService bound to `authz` and, when given, a fixed id for the next insert. */
  service(authz: AuthorizationPort, newId?: () => string): StudioDraftService;
}

export interface StudioResponse {
  status: number;
  body: unknown;
  contentType?: string;
}

const DEFINITION_KEY_RE = /^[a-z][a-z0-9._-]{1,127}$/;
const SOURCE_REF_RE = /^[A-Za-z0-9_.:@-]{1,200}$/;
const NIL_VERSION = '00000000-0000-4000-8000-000000000000';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Stable definition id per tenant + key (UUID v8 layout over SHA-256), so emitting is idempotent. */
export function studioDefinitionId(tenantId: string, definitionKey: string): string {
  const hex = sha256(`cmp-016:definition:${tenantId}:${definitionKey}`).slice('sha256:'.length);
  const variant = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function failure(err: unknown): StudioResponse {
  if (err instanceof Cmp016Error) {
    return {
      status: err.statusCode,
      body: { error_code: err.code, message: err.message, details: err.details },
    };
  }
  return { status: 500, body: { error_code: 'SF-SYS-001', message: 'Unexpected server error' } };
}

export function createStudioWorkflowApi(deps: StudioWorkflowApiDeps) {
  const authzFor = (caller: StudioCaller): AuthorizationPort => ({
    async authorize(_ctx, action, resource) {
      const allow = await deps.authorize(caller, action, resource);
      return { allow, decision_id: caller.correlation_id, policy_revision: 'opa' };
    },
  });
  const requireAllowed = async (caller: StudioCaller, action: WorkflowAction, type: string) => {
    if (!(await deps.authorize(caller, action, { type }))) throw new Cmp016Error('SF-AUTH-002');
  };

  return {
    /** Validates a graph exactly as CMP-016 will and returns its graph_hash and BPMN view. */
    async check(caller: StudioCaller, body: unknown): Promise<StudioResponse> {
      try {
        await requireAllowed(caller, 'WORKFLOW_VERSION_EXPORT_BPMN', 'WorkflowDefinition');
        if (!isRecord(body)) throw invalid('BODY_NOT_OBJECT');
        const graph = parseGraph(body['graph']);
        const versionRef =
          typeof body['version_ref'] === 'string' && isUuid(body['version_ref'])
            ? body['version_ref']
            : NIL_VERSION;
        const model = toCanonicalModel(versionRef, graph);
        return {
          status: 200,
          body: {
            valid: true,
            graph_hash: model.graph_hash,
            node_count: graph.nodes.length,
            edge_count: graph.edges.length,
            bpmn_xml: exportBpmn(model),
            runtime: model.runtime,
            bpmn_role: model.bpmn_role,
          },
        };
      } catch (err) {
        return failure(err);
      }
    },

    /** BPMN → canonical draft graph (screened profile). Never persisted or executed here. */
    async importBpmn(caller: StudioCaller, body: unknown): Promise<StudioResponse> {
      try {
        await requireAllowed(caller, 'WORKFLOW_VERSION_IMPORT_BPMN', 'WorkflowDefinition');
        if (!isRecord(body) || typeof body['xml'] !== 'string')
          throw invalid('BPMN_XML_REQUIRED', '/xml');
        const result = importBpmn(body['xml']);
        return { status: 200, body: result };
      } catch (err) {
        return failure(err);
      }
    },

    /** Emits a Studio graph as a CMP-016 DRAFT version under a stable definition. */
    async createDraft(caller: StudioCaller, body: unknown): Promise<StudioResponse> {
      try {
        if (!isRecord(body)) throw invalid('BODY_NOT_OBJECT');
        const key = body['definition_key'];
        if (typeof key !== 'string' || !DEFINITION_KEY_RE.test(key)) {
          throw invalid('DEFINITION_KEY_INVALID', '/definition_key');
        }
        const expected = body['graph_hash'];
        const graph: WorkflowGraph = parseGraph(body['graph']);
        if (typeof expected !== 'string' || graphHash(graph) !== expected) {
          throw invalid('GRAPH_HASH_MISMATCH', '/graph_hash');
        }
        const source = body['source_ref'];
        if (source !== undefined && (typeof source !== 'string' || !SOURCE_REF_RE.test(source))) {
          throw invalid('SOURCE_REF_INVALID', '/source_ref');
        }
        const authz = authzFor(caller);
        const definitionId = studioDefinitionId(caller.tenant_id, key);
        try {
          await deps
            .service(authz, () => definitionId)
            .createDefinition(caller, {
              definition_key: key,
            });
        } catch (err) {
          if (!(err instanceof Cmp016Error && err.code === 'SF-APP-002')) throw err;
        }
        let draft: WorkflowVersionRecord;
        try {
          draft = await deps.service(authz).createDraft(caller, {
            definition_id: definitionId,
            graph,
          });
        } catch (err) {
          if (err instanceof Cmp016Error && err.code === 'SF-SYS-002') {
            throw new Cmp016Error('SF-APP-002', [
              { code: 'DEFINITION_KEY_TAKEN', pointer: '/definition_key' },
            ]);
          }
          throw err;
        }
        return {
          status: 201,
          body: {
            definition_id: draft.definition_id,
            version_id: draft.version_id,
            version_no: draft.version_no,
            status: draft.status,
            origin: draft.origin,
            graph_hash: draft.model.graph_hash,
            ...(typeof source === 'string' ? { source_ref: source } : {}),
          },
        };
      } catch (err) {
        return failure(err);
      }
    },

    /** Non-executable BPMN view of a stored version (for checkers and other tools). */
    async exportVersionBpmn(caller: StudioCaller, versionId: string): Promise<StudioResponse> {
      try {
        const xml = await deps.service(authzFor(caller)).exportBpmn(caller, versionId);
        return { status: 200, body: xml, contentType: 'application/xml' };
      } catch (err) {
        return failure(err);
      }
    },
  };
}

export type StudioWorkflowApi = ReturnType<typeof createStudioWorkflowApi>;
