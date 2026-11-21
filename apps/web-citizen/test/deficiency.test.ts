import { describe, expect, it } from 'vitest';
import {
  itemLabel,
  reasonLabel,
  SAMPLE_LAB_DEFICIENCY_CATALOGUE,
} from '@serviceform/m10-sample-lab/deficiency-catalogue';
import { portalStatus } from '../lib/portal/applications';
import { applicationStatus } from '../lib/ind-soc-002';
import { activeOpenNotice, type DeficiencyNotice } from '../lib/portal/deficiency';
import { toDeficiencyEvidence } from '../lib/portal/documents';

// REQ SF-47: citizen ACTION_REQUIRED maps from DEFICIENCY_RAISED; resubmit uses catalogue labels.
// REQ SF-49: deficiency evidence_ref is a CMP-013 document id (technical accept).
describe('citizen deficiency status mapping', () => {
  it('maps DEFICIENCY_RAISED to ACTION_REQUIRED with citizen-facing wording', () => {
    expect(portalStatus('DEFICIENCY_RAISED')).toBe('ACTION_REQUIRED');
    expect(
      applicationStatus({ status: 'ACTION_REQUIRED', digilocker: { status: 'NOT_REQUESTED' } }),
    ).toEqual({
      label: 'Action needed · more information requested',
      tone: 'info',
    });
  });

  it('selects only OPEN notices for the resubmit form', () => {
    const notices: DeficiencyNotice[] = [
      {
        deficiency_id: 'a',
        application_id: 'b',
        status: 'CLOSED',
        reason_code: 'MISSING_PROOF',
        notice_code: 'CLARIFY_EVIDENCE',
        instruction_ref: 'ref:x',
        response_due_at: null,
        opened_at: '2026-01-01T00:00:00.000Z',
        responded_at: null,
        closed_at: '2026-01-02T00:00:00.000Z',
        close_reason_code: 'CITIZEN_RESPONDED',
        aggregate_version: 2,
        items: [],
        evidence: [],
      },
      {
        deficiency_id: 'c',
        application_id: 'b',
        status: 'OPEN',
        reason_code: 'MISSING_PROOF',
        notice_code: 'CLARIFY_EVIDENCE',
        instruction_ref: 'ref:x',
        response_due_at: null,
        opened_at: '2026-01-03T00:00:00.000Z',
        responded_at: null,
        closed_at: null,
        close_reason_code: null,
        aggregate_version: 1,
        items: [
          {
            item_seq: 1,
            item_code: 'ELECTRICITY_BILL',
            evidence_requirement_ref: null,
            required: true,
            item_status: 'REQUESTED',
          },
        ],
        evidence: [],
      },
    ];
    expect(activeOpenNotice(notices)?.deficiency_id).toBe('c');
  });

  it('labels catalogue codes without inventing statute text', () => {
    expect(reasonLabel('MISSING_PROOF')).toContain('document');
    expect(itemLabel('ELECTRICITY_BILL')).toBe('Electricity bill');
    expect(SAMPLE_LAB_DEFICIENCY_CATALOGUE.evidence_kind_codes.citizen_upload).toBe(
      'CITIZEN_UPLOAD',
    );
  });

  it('binds deficiency evidence to a CMP-013 document id (not a random UUID mint)', () => {
    const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    expect(toDeficiencyEvidence(documentId).evidence_ref).toBe(documentId);
  });
});
