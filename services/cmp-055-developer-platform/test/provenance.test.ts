import { describe, expect, it } from 'vitest';
import { buildEvidenceManifest } from '../src/provenance.js';

describe('provenance', () => {
  it('builds a non-certified evidence manifest', () => {
    const m = buildEvidenceManifest({
      componentId: 'CMP-055',
      taskId: 'SF-M01-W2-005',
      commitSha: 'a'.repeat(40),
      artifacts: ['evidence/SF-M01-W2-005/EVIDENCE.md'],
      gates: [{ name: 'contracts-lock', result: 'PASS' }],
    });
    expect(m.certified).toBe(false);
    expect(m.self_certified).toBe(false);
    expect(m.schema).toBe('serviceform.cmp055.evidence-manifest.v1');
  });

  it('refuses self-certification claims', () => {
    expect(() =>
      buildEvidenceManifest({
        componentId: 'CMP-055',
        taskId: 'SF-M01-W2-005',
        commitSha: 'b'.repeat(40),
        artifacts: [],
        gates: [],
        selfCertified: true,
      }),
    ).toThrow(/self-certify|CERTIFIED/i);
  });
});
