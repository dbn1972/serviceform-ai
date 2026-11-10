import { describe, expect, it } from 'vitest';
import {
  createStudioWorkflowApi,
  exportBpmn,
  graphHash,
  isUuid,
  studioDefinitionId,
  toCanonicalModel,
  TemporalSequencingAdapter,
  WorkflowService,
  type StudioCaller,
  type WorkflowAction,
} from '../../src/index.js';
import { FakeDb } from '../doubles/fake-db.js';
import { Approvals, RecordingTemporal, ctx } from '../doubles/ports.js';
import { linearGraph, richGraph, T1, T2, V1 } from '../fixtures/models.js';

function caller(over: Partial<StudioCaller> = {}): StudioCaller {
  return { ...ctx(), roles: ['STUDIO_DESIGNER'], ...over };
}

function rig(denied: WorkflowAction[] = []) {
  const db = new FakeDb([]);
  const seen: string[] = [];
  let next = 0;
  const api = createStudioWorkflowApi({
    async authorize(c, action) {
      seen.push(`${c.roles.join(',')}:${action}`);
      return c.roles.includes('STUDIO_DESIGNER') && !denied.includes(action);
    },
    service: (authz, newId) =>
      new WorkflowService({
        pool: db,
        authz,
        approvals: new Approvals(),
        temporal: new TemporalSequencingAdapter(new RecordingTemporal(), 'sf-workflow'),
        newId:
          newId ??
          (() => {
            next += 1;
            return `00000000-0000-4000-8000-${next.toString().padStart(12, '0')}`;
          }),
      }),
  });
  return { api, seen, db };
}

// REQ: Phase C-2 — Studio checks, BPMN interoperability and DRAFT emission go through CMP-016.
describe('CMP-016 Studio API', () => {
  it('checks a graph exactly like parseGraph and returns its graph_hash and BPMN view', async () => {
    const { api } = rig();
    const res = await api.check(caller(), { graph: richGraph(), version_ref: V1 });
    expect(res.status).toBe(200);
    const body = res.body as { graph_hash: string; bpmn_xml: string; runtime: string };
    expect(body.graph_hash).toBe(graphHash(richGraph()));
    expect(body.bpmn_xml).toBe(exportBpmn(toCanonicalModel(V1, richGraph())));
    expect(body.runtime).toBe('TEMPORAL');
    const bad = await api.check(caller(), {
      graph: {
        nodes: [
          { node_id: 'START', kind: 'START' },
          { node_id: 'END', kind: 'END' },
        ],
        edges: [{ from_node: 'END', to_node: 'START' }],
      },
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('START_HAS_INCOMING');
  });

  it('imports BPMN through the screened profile and refuses runtime constructs', async () => {
    const { api } = rig();
    const xml = exportBpmn(toCanonicalModel(V1, linearGraph()));
    const res = await api.importBpmn(caller(), { xml });
    expect(res.status).toBe(200);
    expect((res.body as { graph: unknown }).graph).toEqual(linearGraph());
    const script = xml.replace('</bpmn:process>', '<bpmn:scriptTask id="X"/></bpmn:process>');
    const refused = await api.importBpmn(caller(), { xml: script });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain('BPMN_RUNTIME_CONSTRUCT_FORBIDDEN');
  });

  it('emits idempotent definitions and DRAFT versions, verifying the declared hash', async () => {
    const { api } = rig();
    const graph = linearGraph();
    const first = await api.createDraft(caller(), {
      definition_key: 'lab.studio.flow',
      graph,
      graph_hash: graphHash(graph),
      source_ref: 'cmp-033:doc',
    });
    expect(first.status).toBe(201);
    const body = first.body as { definition_id: string; status: string; version_no: number };
    expect(body.definition_id).toBe(studioDefinitionId(T1, 'lab.studio.flow'));
    expect(isUuid(body.definition_id)).toBe(true);
    expect(body).toMatchObject({ status: 'DRAFT', version_no: 1, origin: 'STUDIO' });
    const second = await api.createDraft(caller(), {
      definition_key: 'lab.studio.flow',
      graph,
      graph_hash: graphHash(graph),
    });
    expect(second.status).toBe(201);
    expect((second.body as { version_no: number }).version_no).toBe(2);
    const mismatch = await api.createDraft(caller(), {
      definition_key: 'lab.studio.flow',
      graph,
      graph_hash: `sha256:${'0'.repeat(64)}`,
    });
    expect(mismatch.status).toBe(400);
    expect(JSON.stringify(mismatch.body)).toContain('GRAPH_HASH_MISMATCH');
    expect(studioDefinitionId(T2, 'lab.studio.flow')).not.toBe(body.definition_id);
  });

  it('is deny-by-default: no role, or a denied action, writes nothing', async () => {
    const { api } = rig(['WORKFLOW_VERSION_DRAFT']);
    const anon = await api.check(caller({ roles: [] }), { graph: linearGraph() });
    expect(anon.status).toBe(403);
    const denied = await api.createDraft(caller(), {
      definition_key: 'lab.denied.flow',
      graph: linearGraph(),
      graph_hash: graphHash(linearGraph()),
    });
    expect(denied.status).toBe(403);
    expect((denied.body as { error_code: string }).error_code).toBe('SF-AUTH-002');
  });

  it('exports a stored version as a non-executable BPMN view', async () => {
    const { api } = rig();
    const created = await api.createDraft(caller(), {
      definition_key: 'lab.export.flow',
      graph: linearGraph(),
      graph_hash: graphHash(linearGraph()),
    });
    const id = (created.body as { version_id: string }).version_id;
    const res = await api.exportVersionBpmn(caller(), id);
    expect(res.status).toBe(200);
    expect(res.contentType).toBe('application/xml');
    expect(String(res.body)).toContain('isExecutable="false"');
    expect((await api.exportVersionBpmn(caller(), 'nope')).status).toBe(400);
  });
});
