import type { FastifyInstance } from 'fastify';

export interface ReadinessCheck {
  name: string;
  check: () => Promise<void>;
}

export interface HealthOptions {
  checks: ReadinessCheck[];
  timeoutMs?: number;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref()),
  ]);

/** Liveness and readiness probes (AWS v1.7 s2: readiness/startup probes are mandatory). */
export async function healthRoutes(app: FastifyInstance, opts: HealthOptions): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 2000;
  const statusSchema = {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', enum: ['ok', 'unavailable'] },
      checks: { type: 'object', additionalProperties: { type: 'string', enum: ['ok', 'failed'] } },
    },
  } as const;

  app.get(
    '/health/live',
    { schema: { response: { 200: statusSchema } }, logLevel: 'warn' },
    async () => ({
      status: 'ok',
    }),
  );

  app.get(
    '/health/ready',
    { schema: { response: { 200: statusSchema, 503: statusSchema } }, logLevel: 'warn' },
    async (_request, reply) => {
      const results: Record<string, 'ok' | 'failed'> = {};
      await Promise.all(
        opts.checks.map(async (c) => {
          try {
            await withTimeout(c.check(), timeoutMs);
            results[c.name] = 'ok';
          } catch {
            results[c.name] = 'failed';
          }
        }),
      );
      const ok = Object.values(results).every((r) => r === 'ok');
      return reply
        .code(ok ? 200 : 503)
        .send({ status: ok ? 'ok' : 'unavailable', checks: results });
    },
  );
}
