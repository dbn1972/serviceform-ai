import { createLogger, startTelemetry } from '@serviceform/observability';
import closeWithGrace from 'close-with-grace';
import { loadConfig } from './config.js';

// Telemetry starts before the app module graph loads so HTTP instrumentation can patch it.
const config = loadConfig();
const telemetry = startTelemetry({
  serviceName: config.SF_SERVICE_NAME,
  serviceVersion: config.SF_SERVICE_VERSION,
  environment: config.SF_ENVIRONMENT,
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
});
const logger = createLogger({
  service: config.SF_SERVICE_NAME,
  version: config.SF_SERVICE_VERSION,
  level: config.LOG_LEVEL,
});

const { buildApp } = await import('./app.js');
const { databaseReadiness } = await import('./readiness.js');

const db = config.DATABASE_URL ? databaseReadiness(config.DATABASE_URL) : undefined;
const app = await buildApp(config, { logger, readinessChecks: db ? [db.check] : [] });

closeWithGrace({ delay: 10_000 }, async ({ err, signal }) => {
  if (err) logger.error({ err }, 'shutting down after error');
  else logger.info({ signal }, 'shutting down');
  await app.close();
  await db?.close();
  await telemetry.shutdown();
});

await app.listen({ host: config.HOST, port: config.PORT });
logger.info({ telemetry: telemetry.enabled, environment: config.SF_ENVIRONMENT }, 'api started');
