/**
 * Provenance / evidence-manifest helpers (Eng v1.4 CMP-055).
 * SBOM generation remains in .github/workflows/security.yml; this shapes the evidence bind.
 */

export type EvidenceManifestInput = {
  componentId: 'CMP-055';
  taskId: string;
  commitSha: string;
  githubRunId?: string;
  githubJob?: string;
  artifacts: string[];
  gates: Array<{ name: string; result: 'PASS' | 'FAIL' }>;
  certified?: boolean;
  selfCertified?: boolean;
};

export type EvidenceManifest = {
  schema: 'serviceform.cmp055.evidence-manifest.v1';
  component_id: 'CMP-055';
  task_id: string;
  commit_sha: string;
  github_run_id: string | null;
  github_job: string | null;
  artifacts: string[];
  gates: Array<{ name: string; result: 'PASS' | 'FAIL' }>;
  certified: false;
  self_certified: false;
  generated_at: string;
};

/** Fixed-length hex SHA check without a quantifier regex (avoids njsscan regex_dos). */
function isGitSha(value: string): boolean {
  if (value.length !== 40) return false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    const isDigit = c >= 48 && c <= 57; // 0-9
    const isLower = c >= 97 && c <= 102; // a-f
    const isUpper = c >= 65 && c <= 70; // A-F
    if (!isDigit && !isLower && !isUpper) return false;
  }
  return true;
}

export function buildEvidenceManifest(
  input: EvidenceManifestInput,
  now = new Date(),
): EvidenceManifest {
  if (input.certified === true || input.selfCertified === true) {
    throw new Error('CMP-055 must not self-certify or claim CERTIFIED');
  }
  if (!isGitSha(input.commitSha)) {
    throw new Error('commitSha must be a 40-char git SHA');
  }
  if (!input.taskId.startsWith('SF-')) {
    throw new Error('taskId must be an SF-* task envelope id');
  }
  return {
    schema: 'serviceform.cmp055.evidence-manifest.v1',
    component_id: 'CMP-055',
    task_id: input.taskId,
    commit_sha: input.commitSha.toLowerCase(),
    github_run_id: input.githubRunId ?? null,
    github_job: input.githubJob ?? null,
    artifacts: [...input.artifacts],
    gates: input.gates.map((g) => ({ name: g.name, result: g.result })),
    certified: false,
    self_certified: false,
    generated_at: now.toISOString(),
  };
}
