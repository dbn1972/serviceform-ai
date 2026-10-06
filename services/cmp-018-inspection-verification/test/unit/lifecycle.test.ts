import { describe, expect, it } from 'vitest';
import { inDomainTransaction } from '../../src/tx-scope.js';
import { TOPIC_DOMAIN } from '../../src/outbox.js';
import { EVENT_TYPE } from '../../src/domain/states.js';
import {
  APP_1,
  ctxFor,
  createBody,
  DOCUMENT,
  EVIDENCE,
  INSPECT_ASSIGNMENT,
  OCR_JOB,
  OFFICER_1,
  ORG_2,
  WORKFLOW_SYSTEM,
} from '../doubles/fixtures.js';
import {
  acceptingEvidence,
  completedOcr,
  idem,
  makeService,
  simulatedDigilocker,
  type Ctx,
} from '../doubles/harness.js';
import type { CaseCommand } from '../../src/ports/case-command.js';

const system = ctxFor(
  WORKFLOW_SYSTEM,
  {
    roles: ['WORKFLOW_ENGINE'],
    organisation_id: undefined,
    office_id: undefined,
    jurisdiction_ids: [],
  },
  'SYSTEM',
) as Ctx;
const officer = ctxFor(OFFICER_1) as Ctx;

async function inProgress() {
  const h = makeService({
    evidence: acceptingEvidence,
    ocr: completedOcr,
    digilocker: simulatedDigilocker(),
  });
  const created = await h.service.createInspection(
    system,
    createBody(),
    idem('POST /v1/inspections'),
  );
  const id = created.body.inspection_id;
  await h.service.schedule(
    officer,
    id,
    {
      window_start: '2026-10-07T09:00:00.000Z',
      window_end: '2026-10-07T11:00:00.000Z',
      slot_ref: 'SLOT:A1',
    },
    idem('POST /s'),
  );
  await h.service.start(officer, id, idem('POST /start'));
  return { ...h, id };
}

describe('inspection lifecycle', () => {
  it('request -> schedule -> start -> checklist/observation/evidence/finding -> result -> complete', async () => {
    const commands: CaseCommand[] = [];
    const h = makeService({
      evidence: acceptingEvidence,
      ocr: completedOcr,
      digilocker: simulatedDigilocker(),
      caseCommands: {
        async submit(c) {
          expect(inDomainTransaction()).toBe(false);
          commands.push(c);
        },
      },
    });
    const created = await h.service.createInspection(
      system,
      createBody(),
      idem('POST /v1/inspections'),
    );
    expect(created.status).toBe(201);
    expect(created.body.statutory_effect).toBe(false);
    expect(created.body.inspection_state).toBe('REQUESTED');
    const id = created.body.inspection_id;
    await h.service.schedule(
      officer,
      id,
      { window_start: '2026-10-07T09:00:00.000Z', slot_ref: 'SLOT:A1' },
      idem('POST /s'),
    );
    await h.service.reassign(
      officer,
      id,
      { assignment: { ...INSPECT_ASSIGNMENT, organisation_id: ORG_2 } },
      idem('POST /r'),
    );
    await h.service.reassign(
      officer,
      id,
      { assignment: { ...INSPECT_ASSIGNMENT } },
      idem('POST /r2'),
    );
    await h.service.start(officer, id, idem('POST /start'));
    await h.service.recordChecklist(
      officer,
      id,
      { item_code: 'SITE_PHOTO', item_state: 'SATISFIED' },
      idem('POST /c'),
    );
    await h.service.recordObservation(
      officer,
      id,
      { item_code: 'SITE_PHOTO', note_ref: 'obs:ref-1', geo_ref: 'geo:cell/token' },
      idem('POST /o'),
    );
    await h.service.attachEvidence(
      officer,
      id,
      { evidence_id: EVIDENCE, document_id: DOCUMENT, ocr_job_id: OCR_JOB },
      idem('POST /e'),
    );
    await h.service.attachEvidence(
      officer,
      id,
      { digilocker_document_ref: 'sim:doc-1' },
      idem('POST /d'),
    );
    await h.service.recordFinding(
      officer,
      id,
      { finding_code: 'FENCE_OK', severity: 'INFO', related_item_code: 'SITE_PHOTO' },
      idem('POST /f'),
    );
    await h.service.recordResult(
      officer,
      id,
      { verification_result: 'VERIFIED' },
      idem('POST /result'),
    );
    const done = await h.service.complete(officer, id, idem('POST /complete'));
    expect(done.body.inspection_state).toBe('COMPLETED');
    expect(done.body.verification_result).toBe('VERIFIED');
    expect(done.body.statutory_effect).toBe(false);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.command_type).toBe('ENTER_VERIFICATION');
    expect(commands[0]?.statutory_effect).toBe(false);
    expect(['RECORD_APPROVED', 'RECORD_REJECTED']).not.toContain(commands[0]?.command_type);

    const detail = await h.service.getDetail(officer, id);
    expect(detail.checklist).toHaveLength(1);
    expect(detail.observations).toHaveLength(1);
    expect(detail.evidence).toHaveLength(2);
    expect(detail.findings).toHaveLength(1);
    expect(detail.evidence.some((e) => e.simulation_marker?.['simulation'] === true)).toBe(true);

    const types = new Set(h.repo.outboxOf(TOPIC_DOMAIN).map((e) => e.event_type));
    expect(types).toContain(EVENT_TYPE.CREATE);
    expect(types).toContain(EVENT_TYPE.COMPLETE);
    expect(JSON.stringify(h.repo.outboxOf(TOPIC_DOMAIN))).not.toMatch(/APPROVED|REJECTED/);
  });

  it('re-inspection opens a new REQUESTED child of a COMPLETED parent', async () => {
    const { service, id } = await inProgress();
    await service.recordResult(
      officer,
      id,
      { verification_result: 'NOT_VERIFIED' },
      idem('POST /res'),
    );
    await service.complete(officer, id, idem('POST /done'));
    const child = await service.reinspect(officer, id, {}, idem('POST /re'));
    expect(child.status).toBe(201);
    expect(child.body.prior_inspection_id).toBe(id);
    expect(child.body.inspection_state).toBe('REQUESTED');
    expect(child.body.application_id).toBe(APP_1);
    const parent = await service.getInspection(officer, id);
    expect(parent.inspection_state).toBe('COMPLETED');
  });

  it('replays identical idempotency keys', async () => {
    const { service } = makeService();
    const key = idem('POST /v1/inspections', createBody(), 'create-xx-1');
    const a = await service.createInspection(system, createBody(), key);
    const b = await service.createInspection(system, createBody(), key);
    expect(b.body.inspection_id).toBe(a.body.inspection_id);
    expect(b.status).toBe(201);
  });
});
