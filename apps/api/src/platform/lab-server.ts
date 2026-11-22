import { createLogger } from '@serviceform/observability';
import closeWithGrace from 'close-with-grace';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { buildPlatformLab } from './runtime.js';

/**
 * SAMPLE_LAB platform host entry (`pnpm --filter @serviceform/api run platform:lab`).
 * Runs with tsx because component plugins load through workspace specifiers.
 */
const config = loadConfig();
const logger = createLogger({
  service: `${config.SF_SERVICE_NAME}-platform-lab`,
  version: config.SF_SERVICE_VERSION,
  level: config.LOG_LEVEL,
});

const lab = await buildPlatformLab(process.env, { logger });
const app = await buildApp(config, {
  logger,
  readinessChecks: lab.readinessChecks,
  m02: lab.m02,
  ...(lab.m03 ? { m03: lab.m03 } : {}),
  m04: lab.m04,
  m05: lab.m05,
  ...(lab.m06 ? { m06: lab.m06 } : {}),
  m07: lab.m07,
  wave2: lab.wave2,
  ...(lab.m08 ? { m08: lab.m08 } : {}),
  ...(lab.m09 ? { m09: lab.m09 } : {}),
});
await lab.registerSimulators(app);
await lab.registerDocumentUploadSimulators(app);
await lab.registerIssuance(app);
await lab.registerStudioWorkflow(app);
await lab.registerStudioRules(app);
await lab.registerFormPins(app);
if (lab.registerGrievance) await lab.registerGrievance(app);
if (lab.registerInspection) await lab.registerInspection(app);
if (lab.registerAssisted) await lab.registerAssisted(app);
if (lab.registerScheduler) await lab.registerScheduler(app);
if (lab.registerPrivacyCentre) await lab.registerPrivacyCentre(app);
if (lab.registerM08) await lab.registerM08(app);
if (lab.registerPayment) await lab.registerPayment(app);
await lab.registerTsbSeal(app);
await lab.registerLicencePermitPinDemos(app);
await lab.start();

closeWithGrace({ delay: 10_000 }, async ({ err, signal }) => {
  if (err) logger.error({ err }, 'platform lab shutting down after error');
  else logger.info({ signal }, 'platform lab shutting down');
  await app.close();
  await lab.close();
});

await app.listen({ host: config.HOST, port: config.PORT });
logger.info(
  {
    environment: config.SF_ENVIRONMENT,
    portal: lab.placement.portal_id,
    mounted: [
      ...app.m02Mounted,
      ...(app.m03Mounted ?? []),
      ...(app.m04Mounted ?? []),
      ...(app.m05Mounted ?? []),
      ...(app.m06Mounted ?? []),
      ...(app.m07Mounted ?? []),
      ...(app.m08Mounted ?? []),
      ...(app.m09Mounted ?? []),
      ...app.wave2Mounted,
    ],
    simulation: true,
    g6_issued: false,
    certified: false,
  },
  'platform lab started',
);
