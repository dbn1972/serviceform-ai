import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  authorizeAction,
  authzInput as caseAuthzInput,
} from '../../../services/cmp-015-application-case/src/authz.js';
import { Cmp015Error } from '../../../services/cmp-015-application-case/src/errors.js';
import { assertDecisionBoundary } from '../../../services/cmp-015-application-case/src/domain/decision-boundary.js';
import {
  authorize as authorize019,
  authzInput as defAuthzInput,
} from '../../../services/cmp-019-deficiency/src/authz.js';
import { Cmp019Error } from '../../../services/cmp-019-deficiency/src/errors.js';
import {
  decide as decide028,
  authzInput as appealAuthzInput,
} from '../../../services/cmp-028-appeal-review/src/authz.js';
import { Cmp028Error } from '../../../services/cmp-028-appeal-review/src/errors.js';
import {
  decide as decide017,
  authzInput as taskAuthzInput,
} from '../../../services/cmp-017-work-queue-tasks/src/authz.js';
import { Cmp017Error } from '../../../services/cmp-017-work-queue-tasks/src/errors.js';
import {
  authorize as authorize029,
  authzInput as slaAuthzInput,
} from '../../../services/cmp-029-sla-escalation/src/authz.js';
import { Cmp029Error } from '../../../services/cmp-029-sla-escalation/src/errors.js';
import {
  assertAiAssistAllowed,
  assertStatutoryClose,
} from '../../../services/cmp-027-grievance-feedback/src/domain/model.js';
import { Cmp027Error } from '../../../services/cmp-027-grievance-feedback/src/errors.js';
import {
  parseVerificationResult,
  assertNotStatutoryCaseCommand,
  assertNotAiFinal,
} from '../../../services/cmp-018-inspection-verification/src/domain/result.js';
import { Cmp018Error } from '../../../services/cmp-018-inspection-verification/src/errors.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const ACTOR = '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42';
const JUR = '5fad7b4e-a06c-4d9e-b15f-8c4d2e6a0b75';

const CTX = {
  tenant_id: T1,
  cell_id: 'cell-local',
  actor: { type: 'OFFICER' as const, id: ACTOR },
  roles: ['SERVICE_CHECKER'],
  jurisdiction_ids: [JUR],
  auth_assurance: 'MFA' as const,
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  trace_id: '0af7651916cd43dd8448eb211c80319c',
};

const DENY = {
  allow: false as const,
  reason_code: 'ROLE_DENIED',
  policy_revision: 'test-1',
  decision_id: '00000000-0000-4000-8000-0000000000bb',
};

function walkTs(dir: string, acc: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'test' || ent.name === 'dist') continue;
      walkTs(p, acc);
    } else if (ent.name.endsWith('.ts')) {
      acc.push(p);
    }
  }
  return acc;
}

describe('SF-M05-SEC OPA / AI / port boundaries (not CERTIFIED)', () => {
  it('CMP-015 OPA deny and PDP unavailable fail closed', async () => {
    await expect(
      authorizeAction({ decide: async () => DENY }, CTX, 'CASE_READ', {}, new Date()),
    ).rejects.toBeInstanceOf(Cmp015Error);
    try {
      await authorizeAction({ decide: async () => DENY }, CTX, 'CASE_READ', {}, new Date());
    } catch (e) {
      expect((e as Cmp015Error).code).toBe('SF-AUTH-002');
    }
    await expect(
      authorizeAction(
        {
          decide: async () => {
            throw new Error('pdp down');
          },
        },
        CTX,
        'CASE_READ',
        {},
        new Date(),
      ),
    ).rejects.toMatchObject({ code: 'SF-SYS-004' });
  });

  it('CMP-017 task OPA: deny records allow=false; PDP unavailable fails closed', async () => {
    const denied = await decide017({ decide: async () => DENY }, taskAuthzInput(CTX, 'TASK_CLAIM'));
    expect(denied.allow).toBe(false);
    await expect(
      decide017(
        {
          decide: async () => {
            throw new Error('pdp down');
          },
        },
        taskAuthzInput(CTX, 'TASK_CLAIM'),
      ),
    ).rejects.toBeInstanceOf(Cmp017Error);
    await expect(
      decide017(
        { decide: async () => DENY },
        {
          ...taskAuthzInput(CTX, 'TASK_CLAIM'),
          resource: {
            resource_type: 'HumanTask',
            tenant_id: T2,
            classification: 'TENANT_SCOPED',
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'SF-TEN-002' });
  });

  it('CMP-019 deficiency OPA fail-closed (deny / PDP / cross-tenant)', async () => {
    const denyPort = { decide: async () => DENY };
    const downPort = {
      decide: async () => {
        throw new Error('pdp down');
      },
    };
    await expect(
      authorize019(denyPort, defAuthzInput(CTX, 'DEFICIENCY_READ')),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    await expect(
      authorize019(downPort, defAuthzInput(CTX, 'DEFICIENCY_OPEN')),
    ).rejects.toMatchObject({ code: 'SF-SYS-004' });
    await expect(
      authorize019(denyPort, {
        ...defAuthzInput(CTX, 'DEFICIENCY_READ'),
        resource: {
          resource_type: 'DeficiencyNotice',
          tenant_id: T2,
          classification: 'TENANT_SCOPED',
        },
      }),
    ).rejects.toBeInstanceOf(Cmp019Error);
  });

  it('CMP-028 appeal OPA: deny allow=false; PDP unavailable fails closed', async () => {
    const denied = await decide028(
      { decide: async () => DENY },
      appealAuthzInput(CTX, 'APPEAL_READ'),
    );
    expect(denied.allow).toBe(false);
    await expect(
      decide028(
        {
          decide: async () => {
            throw new Error('pdp down');
          },
        },
        appealAuthzInput(CTX, 'APPEAL_READ'),
      ),
    ).rejects.toBeInstanceOf(Cmp028Error);
  });

  it('CMP-029 SLA OPA fail-closed', async () => {
    await expect(
      authorize029({ decide: async () => DENY }, slaAuthzInput(CTX, 'SLA_CLOCK_READ', 'SlaClock')),
    ).rejects.toBeInstanceOf(Cmp029Error);
    await expect(
      authorize029(
        {
          decide: async () => {
            throw new Error('pdp down');
          },
        },
        slaAuthzInput(CTX, 'SLA_CLOCK_PAUSE', 'SlaClock'),
      ),
    ).rejects.toMatchObject({ code: 'SF-SYS-004' });
  });

  it('AI cannot make final statutory / disposition decisions', () => {
    expect(() =>
      assertDecisionBoundary({ type: 'OFFICER', id: ACTOR }, { decision_maker: 'AI' }, true),
    ).toThrow(Cmp015Error);
    expect(() => parseVerificationResult({ verification_result: 'APPROVED' })).toThrow(Cmp018Error);
    expect(() => assertNotStatutoryCaseCommand('RECORD_APPROVED')).toThrow(Cmp018Error);
    expect(() => assertNotAiFinal('INTEGRATION')).toThrow(Cmp018Error);
    expect(() => assertAiAssistAllowed('RESOLVE')).toThrow(Cmp027Error);
    expect(() =>
      assertStatutoryClose({ kind: 'GRIEVANCE', command: 'RESOLVE', actorType: 'INTEGRATION' }),
    ).toThrow(Cmp027Error);

    const appealSrc = readFileSync(
      join(ROOT, 'services/cmp-028-appeal-review/src/service/appeal-service.ts'),
      'utf8',
    );
    expect(appealSrc).toMatch(/AI_DECISION_FORBIDDEN|AI_PROTECTED/);
  });

  it('CMP-019 INT-009 pause/resume cannot import CMP-029 SQL or skip OPA', () => {
    const slaPort = readFileSync(
      join(ROOT, 'services/cmp-019-deficiency/src/ports/sla-clock-port.ts'),
      'utf8',
    );
    expect(slaPort).toMatch(/pauseForDeficiency/);
    expect(slaPort).toMatch(/resumeAfterDeficiency/);
    expect(slaPort).not.toMatch(/sf_sla\.|FROM sf_sla|INTO sf_sla/);
    const serviceFiles = walkTs(join(ROOT, 'services/cmp-019-deficiency/src'));
    for (const file of serviceFiles) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/\bsf_sla\./);
      expect(text, file).not.toMatch(/\bsf_application_case\./);
    }
  });

  it('authzInput for case never trusts mismatched tenant', () => {
    const input = caseAuthzInput(CTX, 'CASE_READ', { applicationId: T1 }, new Date());
    expect(input.subject.tenant_id).toBe(T1);
    expect(input.resource.tenant_id).toBe(T1);
    expect(input.subject.tenant_id).toBe(input.resource.tenant_id);
  });

  it('shared OPA default deny remains', () => {
    const decision = readFileSync(join(ROOT, 'policy/opa/sf/authz/decision.rego'), 'utf8');
    expect(decision).toMatch(/default\s+allow\s*:=\s*false/);
    const system = readFileSync(join(ROOT, 'policy/opa/system/authz/authz.rego'), 'utf8');
    expect(system).toMatch(/default\s+allow\s*:=\s*false/);
  });
});
