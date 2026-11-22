import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  LAB_LICENCE_PERMIT_PIN_DEMOS,
  registerLabLicencePermitPinDemoRoutes,
  stubFormVersionId,
} from '../src/platform/licence-permit-pin-demos.js';

describe('SAMPLE_LAB Licence/Permit pin-demo routes', () => {
  it('lists pin demos in LOCAL and refuses PRODUCTION', async () => {
    const app = Fastify();
    registerLabLicencePermitPinDemoRoutes(app, {
      environment: 'LOCAL',
      catalogue: LAB_LICENCE_PERMIT_PIN_DEMOS,
    });
    const ok = await app.inject({ method: 'GET', url: '/v1/lab/licence-permit-pin-demos' });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as {
      citizen_offerable: boolean;
      certified: boolean;
      g6: boolean;
      digilocker_mode: string;
      catalogue: { targets: { catalogue_id: string }[] };
    };
    expect(body.citizen_offerable).toBe(false);
    expect(body.certified).toBe(false);
    expect(body.g6).toBe(false);
    expect(body.digilocker_mode).toBe('SIMULATED');
    expect(body.catalogue.targets.map((t) => t.catalogue_id)).toEqual([
      'IND-BTP-001',
      'IND-LAB-019',
      'IND-ULB-007',
    ]);
    await app.close();

    const prod = Fastify();
    registerLabLicencePermitPinDemoRoutes(prod, {
      environment: 'PRODUCTION',
      catalogue: LAB_LICENCE_PERMIT_PIN_DEMOS,
    });
    const denied = await prod.inject({ method: 'GET', url: '/v1/lab/licence-permit-pin-demos' });
    expect(denied.statusCode).toBe(403);
    await prod.close();
  });

  it('resolves Trade Licence Studio→TSB pin graph without claiming offerable', async () => {
    const app = Fastify();
    registerLabLicencePermitPinDemoRoutes(app, {
      environment: 'CI',
      catalogue: LAB_LICENCE_PERMIT_PIN_DEMOS,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/lab/licence-permit-pin-demos/IND-BTP-001',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      citizen_offerable: boolean;
      target: {
        catalogue_id: string;
        status: string;
        inspection_pin_code: string;
        pins: { form_version_id: string };
      };
    };
    expect(body.citizen_offerable).toBe(false);
    expect(body.target.catalogue_id).toBe('IND-BTP-001');
    expect(body.target.status).toBe('DRAFT');
    expect(body.target.inspection_pin_code).toBe('TRADE_LICENCE_SITE_VISIT');
    expect(body.target.pins.form_version_id).toBe(stubFormVersionId('IND-BTP-001'));
    await app.close();
  });
});
