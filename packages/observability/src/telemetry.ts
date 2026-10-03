import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

export interface TelemetryConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  /** OTLP/HTTP base URL, e.g. http://localhost:4318. Telemetry is off when unset. */
  otlpEndpoint?: string | undefined;
}

export interface TelemetryHandle {
  enabled: boolean;
  shutdown: () => Promise<void>;
}

/**
 * Starts the OpenTelemetry Node SDK (traces + metrics over OTLP/HTTP). Call before the
 * application module graph loads so HTTP instrumentation can patch core modules.
 * Request/response headers and bodies are not recorded as span attributes.
 */
export function startTelemetry(config: TelemetryConfig): TelemetryHandle {
  if (!config.otlpEndpoint || process.env['OTEL_SDK_DISABLED'] === 'true') {
    return { enabled: false, shutdown: async () => {} };
  }
  const base = config.otlpEndpoint.replace(/\/$/, '');
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      'deployment.environment.name': config.environment,
    }),
    traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
        exportIntervalMillis: 15_000,
      }),
    ],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => req.url?.startsWith('/health') ?? false,
      }),
    ],
  });
  sdk.start();
  return { enabled: true, shutdown: () => sdk.shutdown() };
}
