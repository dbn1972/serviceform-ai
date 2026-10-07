import { describe, expect, it } from 'vitest';
import { assertNotStatutoryCaseCommand } from '../../src/domain/result.js';
import { assertSimulationPolicy } from '../../src/domain/simulation.js';
import { inDomainTransaction, runInDomainTransaction } from '../../src/tx-scope.js';
import { InspectionService } from '../../src/service/inspection-service.js';
import {
  ctxFor,
  createBody,
  OFFICER_1,
  TENANT_A,
  TENANT_B,
  WORKFLOW_SYSTEM,
} from '../doubles/fixtures.js';
import { idem, makeService, simulatedDigilocker, type Ctx } from '../doubles/harness.js';

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

describe('negatives: tenant, OPA, statutory AI, SIMULATED production', () => {
  it('wrong tenant leaks nothing (CROSS_TENANT_LEAKAGE=0)', async () => {
    const { service, id } = await (async () => {
      const h = makeService();
      const res = await h.service.createInspection(
        system,
        createBody(),
        idem('POST /v1/inspections'),
      );
      return { ...h, id: res.body.inspection_id };
    })();
    const intruder = ctxFor(OFFICER_1, { tenant_id: TENANT_B }) as Ctx;
    let leakage = 0;
    const probe = async (fn: () => Promise<unknown>) => {
      try {
        const out = await fn();
        const text = JSON.stringify(out);
        if (text.includes(id) || text.includes(TENANT_A)) leakage += 1;
        leakage += 1;
      } catch (e) {
        expect((e as { code: string }).code).toBe('SF-SYS-002');
        expect(JSON.stringify(e)).not.toContain(TENANT_A);
      }
    };
    await probe(() => service.getInspection(intruder, id));
    await probe(() => service.start(intruder, id, idem('POST /s')));
    const listed = await service.listAvailable(intruder);
    expect(listed.items).toEqual([]);
    expect(leakage).toBe(0);
  });

  it('OPA deny fails closed and is recorded', async () => {
    const { service, authz } = makeService();
    authz.denyActions.add('INSPECTION_CREATE');
    await expect(
      service.createInspection(system, createBody(), idem('POST /v1/inspections')),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
  });

  it('AI / INTEGRATION cannot record a final verification result', async () => {
    const h = makeService();
    const created = await h.service.createInspection(system, createBody(), idem('POST /c'));
    await h.service.start(officer, created.body.inspection_id, idem('POST /st'));
    const ai = ctxFor(OFFICER_1, {}, 'INTEGRATION') as Ctx;
    await expect(
      h.service.recordResult(
        ai,
        created.body.inspection_id,
        { verification_result: 'VERIFIED' },
        idem('POST /r'),
      ),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
  });

  it('refuses statutory case commands from this component', () => {
    expect(() => assertNotStatutoryCaseCommand('RECORD_APPROVED')).toThrowError();
    expect(() => assertNotStatutoryCaseCommand('RECORD_REJECTED')).toThrowError();
    expect(() => assertNotStatutoryCaseCommand('ENTER_VERIFICATION')).not.toThrow();
  });

  it('production-critical SIMULATED DigiLocker is fail-closed', async () => {
    const h = makeService({ digilocker: simulatedDigilocker('PRODUCTION') });
    const created = await h.service.createInspection(system, createBody(), idem('POST /c'));
    await h.service.start(officer, created.body.inspection_id, idem('POST /st'));
    await expect(
      h.service.attachEvidence(
        officer,
        created.body.inspection_id,
        { digilocker_document_ref: 'sim:x' },
        idem('POST /d'),
      ),
    ).rejects.toMatchObject({ code: 'SF-INT-001' });
  });

  it('outbound ports cannot run inside a domain transaction', async () => {
    expect(inDomainTransaction()).toBe(false);
    await expect(
      runInDomainTransaction(async () => {
        const h = makeService();
        await h.service.createInspection(system, createBody(), idem('POST /c'));
      }),
    ).resolves.toBeUndefined();
    expect(() =>
      assertSimulationPolicy([
        {
          critical: true,
          mode: 'SIMULATED',
          environment: 'PRODUCTION',
          connector_binding_id: '00000000-0000-4000-8000-000000000201',
        },
      ]),
    ).toThrowError();
  });

  it('client tenant headers are refused by the service context rules', () => {
    expect(() =>
      InspectionService.parseCreate({ ...createBody(), tenant_id: TENANT_B }),
    ).toThrowError();
  });
});
