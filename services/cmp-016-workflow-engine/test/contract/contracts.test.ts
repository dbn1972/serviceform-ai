import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  Cmp016Error,
  ERROR_CODES,
  exportBpmn,
  importBpmn,
  parseCanonicalModel,
  parseGraph,
  signalFromCommandTransition,
  toCanonicalModel,
  type CommandTransitionRecord,
} from '../../src/index.js';
import { M05, ROOT, V1, frozenExample, model, richGraph } from '../fixtures/models.js';

// Frozen schemas are validated with the repository's pinned Ajv (as SF-M05-CG-001 does),
// resolved through packages/contracts so this component adds no dependency.
const require = createRequire(join(ROOT, 'packages/contracts/package.json'));
const { Ajv2020 } = require('ajv/dist/2020.js') as { Ajv2020: new (o: object) => AjvLike };
const addFormatsModule = require('ajv-formats') as { default?: (a: AjvLike) => void } & ((
  a: AjvLike,
) => void);
const addFormats = addFormatsModule.default ?? addFormatsModule;

interface AjvLike {
  addSchema(s: object): void;
  getSchema(id: string): ((d: unknown) => boolean) | undefined;
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
for (const dir of [join(ROOT, 'contracts/shared/schemas'), join(M05, 'schemas')]) {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(readFileSync(join(dir, f), 'utf8')) as object);
  }
}
const workflowSchema = ajv.getSchema('https://contracts.serviceform.ai/m05/workflow-model/v1') as (
  d: unknown,
) => boolean;
const humanTaskSchema = ajv.getSchema('https://contracts.serviceform.ai/m05/human-task/v1') as (
  d: unknown,
) => boolean;

function lockHash(path: string): string | undefined {
  const lock = readFileSync(join(ROOT, 'orchestrator/contracts-lock.yaml'), 'utf8');
  const block = lock.split('  - id: ').find((b) => b.includes(`path: ${path}`));
  return block?.match(/schema_hash: ([0-9a-f]{64})/)?.[1];
}

describe('SF-CON-WORKFLOW-MODEL conformance (FROZEN, read-only)', () => {
  it('consumes the frozen schema whose hash matches orchestrator/contracts-lock.yaml', () => {
    const path = 'contracts/m05/schemas/workflow-model.schema.json';
    const actual = createHash('sha256')
      .update(readFileSync(join(ROOT, path)))
      .digest('hex');
    expect(actual).toBe(lockHash(path));
    expect(actual).toBe('71b20b1803525991a72c3983de0b0c7f7efa8cb76e37c31089f3978e994e2015');
  });

  it('every canonical model this component emits validates against the frozen schema', () => {
    expect(workflowSchema(model())).toBe(true);
    const imported = importBpmn(exportBpmn(model()));
    expect(workflowSchema(toCanonicalModel(V1, imported.graph))).toBe(true);
  });

  it('agrees with the frozen schema on every frozen example', () => {
    for (const kind of ['valid', 'invalid'] as const) {
      for (const f of readdirSync(join(M05, 'examples', kind)).filter((n) =>
        n.startsWith('workflow-model'),
      )) {
        const doc = frozenExample(kind, f.replace(/\.json$/, ''));
        const schemaOk = workflowSchema(doc);
        let parserOk = true;
        try {
          parseCanonicalModel(doc);
        } catch (err) {
          if (!(err instanceof Cmp016Error)) throw err;
          parserOk = false;
        }
        expect({ f, schemaOk, parserOk }).toEqual({
          f,
          schemaOk: kind === 'valid',
          parserOk: kind === 'valid',
        });
      }
    }
  });

  it('human-task assignment emitted for CMP-017 conforms to SF-CON-HUMAN-TASK (no named officer)', () => {
    const graph = parseGraph(richGraph());
    const assignment = graph.nodes.find((n) => n.kind === 'HUMAN_TASK')?.assignment;
    expect(assignment).toBeDefined();
    const { claim_mode: _claimMode, ...taskAssignment } = assignment as NonNullable<
      typeof assignment
    >;
    const record = {
      ...frozenExample('valid', 'human-task'),
      assignment: taskAssignment,
    };
    expect(humanTaskSchema(record)).toBe(true);
    expect(humanTaskSchema(frozenExample('invalid', 'human-task.named-officer-field'))).toBe(false);
  });
});

describe('SF-CON-COMMAND-TRANSITION consumption (CMP-015 commit before Temporal)', () => {
  const evt = '12345678-1234-4123-8123-123456789abc';

  it('accepts the frozen committed example as a workflow signal', () => {
    const rec = frozenExample('valid', 'command-transition') as unknown as CommandTransitionRecord;
    const s = signalFromCommandTransition(rec, evt);
    expect(s).toMatchObject({
      source_component: 'CMP-015',
      outcome: rec.command_type,
      domain_committed: true,
    });
    expect(s.workflow_version_id).toBe(rec.pin_set.workflow_version_id);
  });

  it('rejects both frozen invalid examples', () => {
    for (const name of [
      'command-transition.temporal-before-commit',
      'command-transition.network-in-txn',
    ]) {
      const rec = frozenExample('invalid', name) as unknown as CommandTransitionRecord;
      expect(() => signalFromCommandTransition(rec, evt)).toThrow(Cmp016Error);
    }
  });
});

describe('error catalogue (FROZEN SF-CON-ERROR-CATALOGUE)', () => {
  it('local codes mirror the frozen catalogue', () => {
    const catalogue = JSON.parse(
      readFileSync(join(ROOT, 'contracts/shared/error-catalogue.json'), 'utf8'),
    ) as {
      codes: { code: string; message: string; http: number[] }[];
    };
    for (const [code, entry] of Object.entries(ERROR_CODES)) {
      const frozen = catalogue.codes.find((c) => c.code === code);
      expect(frozen, code).toBeDefined();
      expect(frozen?.message).toBe(entry.message);
      expect(frozen?.http).toContain(entry.http);
    }
  });
});

describe('component-local event contract', () => {
  it('asyncapi lists every domain event type emitted to sf.workflow.events.v1', async () => {
    const { DOMAIN_EVENT_TYPES, TOPIC_DOMAIN } = await import('../../src/index.js');
    const doc = JSON.parse(
      readFileSync(join(ROOT, 'services/cmp-016-workflow-engine/contracts/asyncapi.json'), 'utf8'),
    ) as { channels: Record<string, { messages: Record<string, unknown> }> };
    expect(Object.keys(doc.channels[TOPIC_DOMAIN]?.messages ?? {}).sort()).toEqual(
      [...DOMAIN_EVENT_TYPES].sort(),
    );
  });
});
