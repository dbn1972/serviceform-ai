import { InspectionService } from '../../src/service/inspection-service.js';
import type { Idempotency } from '../../src/service/inspection-service.js';
import type { TenantContext } from '../../src/context.js';
import { requestFingerprint } from '../../src/domain/fingerprint.js';
import type { CaseCommandPort } from '../../src/ports/case-command.js';
import type { DigiLockerPort } from '../../src/ports/digilocker.js';
import type { EvidencePort } from '../../src/ports/evidence.js';
import type { OcrPort } from '../../src/ports/ocr.js';
import { ScriptedAuthorizer } from './authorizer.js';
import { BINDING, DOCUMENT, idemKey } from './fixtures.js';
import { MemoryInspectionRepository } from './memory-repo.js';
import { ScriptedScope } from './scope.js';

export function makeService(
  opts: {
    evidence?: EvidencePort;
    ocr?: OcrPort;
    digilocker?: DigiLockerPort;
    caseCommands?: CaseCommandPort;
  } = {},
) {
  const repo = new MemoryInspectionRepository();
  const authz = new ScriptedAuthorizer();
  const scopes = new ScriptedScope();
  let tick = 0;
  let idSeq = 5000;
  const clock = () => new Date(Date.UTC(2026, 9, 6, 12, 0, tick++));
  const newId = () => `00000000-0000-4000-8000-${String(idSeq++).padStart(12, '0')}`;
  const service = new InspectionService({
    repo,
    authz,
    scopes,
    clock,
    newId,
    ...opts,
  });
  return { service, repo, authz, scopes };
}

export function idem(endpoint: string, body: unknown = null, key: string = idemKey()): Idempotency {
  return { key, endpoint, fingerprint: requestFingerprint('POST', endpoint, body) };
}

export const acceptingEvidence: EvidencePort = {
  async lookup() {
    return { technical_acceptance: 'ACCEPTED' };
  },
};

export const completedOcr: OcrPort = {
  async lookup(_t, ocr_job_id) {
    return { ocr_job_id, status: 'COMPLETED' };
  },
};

export function simulatedDigilocker(environment = 'CI'): DigiLockerPort {
  return {
    binding() {
      return {
        critical: true,
        mode: 'SIMULATED',
        environment,
        connector_binding_id: BINDING,
      };
    },
    async lookup() {
      return {
        document_id: DOCUMENT,
        simulation_marker: {
          simulation: true,
          scenario: 'digilocker_probe',
          test_run_id: 'cmp-018-int-013',
          connector_binding_id: BINDING,
          environment,
        },
      };
    },
  };
}

export type Ctx = TenantContext;
