import { describe, expect, it } from 'vitest';
import { canonicalSha256 } from '../src/platform/forms.js';
import {
  StudioPublishedRulePackPort,
  StudioRuleEvaluationPort,
  type PublishedRulePackLike,
} from '../src/platform/rules.js';

class NotFound extends Error {}

const TENANT = '0d15ba00-0001-4000-8000-0d15ba0000d1';
const DOC = '0d15ba00-00c8-4000-8000-0d15ba0000c8';
const PACK = {
  rule_pack_id: 'lab.studio.residence-period',
  engine: 'GORULES',
  jdm: { nodes: [{ id: 'input', type: 'inputNode' }], edges: [] },
  outcome_field: 'eligibility',
  reason_codes_field: 'reasons',
};

function port(read: ConstructorParameters<typeof StudioPublishedRulePackPort>[0]['read']) {
  return new StudioPublishedRulePackPort({
    read,
    isNotFound: (err) => err instanceof NotFound,
    notFound: () => new NotFound(),
  });
}

// REQ: Phase C live-pins — CMP-033-backed RulePackPort for Studio packs.
describe('StudioPublishedRulePackPort', () => {
  it('resolves a PUBLISHED CMP-033 RULES document by id and recomputes its hash', async () => {
    const seen: unknown[] = [];
    const p = port(async (input) => {
      seen.push(input);
      return { document_id: DOC, payload: { ...PACK, content_hash: 'x', test_cases: [] } };
    });
    const pack = await p.resolve({
      tenantId: TENANT,
      packKey: '',
      versionId: DOC,
      contentHash: '',
      correlationId: '0d15ba00-00c2-4000-8000-0d15ba0000c2',
    });
    expect(seen).toEqual([{ tenantId: TENANT, documentId: DOC, kind: 'RULES' }]);
    expect(pack).toEqual({
      tenant_id: TENANT,
      pack_key: PACK.rule_pack_id,
      version_id: DOC,
      content_hash: canonicalSha256({
        rule_pack_id: PACK.rule_pack_id,
        engine: PACK.engine,
        jdm: PACK.jdm,
        outcome_field: PACK.outcome_field,
        reason_codes_field: PACK.reason_codes_field,
      }),
      status: 'PUBLISHED',
      payload: { ...PACK, content_hash: 'x', test_cases: [] },
    });
  });

  it('prefers the catalogue when a pack key is supplied', async () => {
    const catalogued: PublishedRulePackLike = {
      tenant_id: TENANT,
      pack_key: 'fixture.pack',
      version_id: '0d15ba00-0011-4000-8000-0d15ba000011',
      content_hash: `sha256:${'c'.repeat(64)}`,
      status: 'PUBLISHED',
      payload: {},
    };
    let reads = 0;
    const p = new StudioPublishedRulePackPort({
      catalogue: { resolve: async () => catalogued },
      read: async () => {
        reads += 1;
        return null;
      },
      isNotFound: () => false,
      notFound: () => new NotFound(),
    });
    expect(
      await p.resolve({
        tenantId: TENANT,
        packKey: 'fixture.pack',
        versionId: catalogued.version_id,
        contentHash: catalogued.content_hash,
        correlationId: 'c',
      }),
    ).toBe(catalogued);
    expect(reads).toBe(0);
  });

  it('is not-found for unpublished or non-rules payloads and hash/key mismatches', async () => {
    await expect(
      port(async () => null).resolve({
        tenantId: TENANT,
        packKey: '',
        versionId: DOC,
        contentHash: '',
        correlationId: 'c',
      }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      port(async () => ({ document_id: DOC, payload: { pages: [] } })).resolve({
        tenantId: TENANT,
        packKey: '',
        versionId: DOC,
        contentHash: '',
        correlationId: 'c',
      }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      port(async () => ({ document_id: DOC, payload: PACK })).resolve({
        tenantId: TENANT,
        packKey: 'other.pack',
        versionId: DOC,
        contentHash: '',
        correlationId: 'c',
      }),
    ).rejects.toBeInstanceOf(NotFound);
  });
});

describe('StudioRuleEvaluationPort', () => {
  it('evaluates the pinned Studio pack on the engine and returns the outcome field', async () => {
    const packs = port(async () => ({ document_id: DOC, payload: PACK }));
    const portEval = new StudioRuleEvaluationPort({
      packs,
      engine: {
        evaluate: async (_jdm, inputs) => ({
          outputs: { eligibility: inputs['ok'] === true ? 'ELIGIBLE' : 'INELIGIBLE' },
        }),
      },
      loadCase: async () => ({ rule_version_id: DOC, inputs: { ok: true } }),
      refuse: (code) => new Error(code),
    });
    await expect(
      portEval.evaluate(
        { tenant_id: TENANT, correlation_id: 'c' },
        { application_id: DOC, node_id: 'RULE', rule_ref: 'lab.ref' },
      ),
    ).resolves.toEqual({ outcome: 'ELIGIBLE' });
  });

  it('fails closed when the pack or outcome is missing', async () => {
    const portEval = new StudioRuleEvaluationPort({
      packs: port(async () => null),
      engine: { evaluate: async () => ({ outputs: {} }) },
      loadCase: async () => ({ rule_version_id: DOC, inputs: {} }),
      refuse: (code) => new Error(code),
    });
    await expect(
      portEval.evaluate(
        { tenant_id: TENANT, correlation_id: 'c' },
        { application_id: DOC, node_id: 'RULE', rule_ref: 'lab.ref' },
      ),
    ).rejects.toThrow('RULE_PACK_NOT_FOUND');
  });
});
