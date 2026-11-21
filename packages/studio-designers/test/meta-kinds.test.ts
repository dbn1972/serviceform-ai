import { describe, expect, it } from 'vitest';
import {
  blankFee,
  buildFeeDocument,
  feeDocumentOf,
  feeHasErrors,
  lintFee,
  transferCertificateDummyFee,
} from '../src/fee';
import {
  blankSla,
  buildSlaDocument,
  lintSla,
  residenceSampleSla,
  slaDocumentOf,
  slaHasErrors,
} from '../src/sla';
import {
  blankEvidence,
  buildEvidenceDocument,
  evidenceDocumentOf,
  evidenceHasErrors,
  lintEvidence,
  residenceSampleEvidence,
} from '../src/evidence';
import {
  blankCredential,
  buildCredentialDocument,
  credentialDocumentOf,
  credentialHasErrors,
  lintCredential,
  residenceSampleCredential,
} from '../src/credential';

// REQ: SF-59 Studio Fee/SLA/Evidence/Credential designers (CMP-033 pin parity).
describe('fee designer', () => {
  it('compiles SAMPLE_LAB DUMMY fee>0 with content_hash over items', async () => {
    const design = transferCertificateDummyFee();
    const doc = await buildFeeDocument(design);
    expect(doc.payload.items[0]?.amount_minor).toBe(999);
    expect(doc.payload.amount_display).toMatch(/SAMPLE_LAB DUMMY/);
    expect(doc.payload.not_statutory).toBe(true);
    expect(doc.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(feeDocumentOf(doc.payload)?.design.packKey).toBe(design.packKey);
    expect(feeHasErrors(lintFee(design))).toBe(false);
  });

  it('refuses negative amounts', () => {
    const design = blankFee();
    const [item] = design.items;
    expect(item).toBeDefined();
    if (!item) return;
    item.amount_minor = -1;
    expect(lintFee(design).some((i) => i.code === 'AMOUNT_INVALID')).toBe(true);
  });
});

describe('sla designer', () => {
  it('compiles SAMPLE_LAB residence SLA with ISO duration pin', async () => {
    const design = residenceSampleSla();
    const doc = await buildSlaDocument(design);
    expect(doc.payload.clocks[0]?.duration_iso).toBe('P10D');
    expect(doc.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(slaDocumentOf(doc.payload)?.contentHash).toBe(doc.contentHash);
    expect(slaHasErrors(lintSla(blankSla()))).toBe(false);
  });

  it('refuses invalid ISO durations', () => {
    const design = blankSla();
    const [clock] = design.clocks;
    expect(clock).toBeDefined();
    if (!clock) return;
    clock.duration_iso = '10 days';
    expect(lintSla(design).some((i) => i.code === 'DURATION_INVALID')).toBe(true);
  });
});

describe('evidence designer', () => {
  it('compiles SAMPLE_LAB evidence requirements', async () => {
    const design = residenceSampleEvidence();
    const doc = await buildEvidenceDocument(design);
    expect(doc.payload.requirements).toHaveLength(2);
    expect(doc.payload.requirements[0]?.artifact_type).toBe('proof_of_address');
    expect(evidenceDocumentOf(doc.payload)?.design.title).toContain('Residence');
    expect(evidenceHasErrors(lintEvidence(blankEvidence()))).toBe(false);
  });
});

describe('credential designer', () => {
  it('compiles SAMPLE_LAB DigiLocker label overlay', async () => {
    const design = residenceSampleCredential();
    const doc = await buildCredentialDocument(design);
    expect(doc.payload.template_key).toBe('lab.ind-soc-002.resident-certificate');
    expect(doc.payload.digilocker_label).toMatch(/SAMPLE_LAB/);
    expect(credentialDocumentOf(doc.payload)?.design.templateKey).toBe(design.templateKey);
    expect(credentialHasErrors(lintCredential(blankCredential()))).toBe(false);
  });
});
