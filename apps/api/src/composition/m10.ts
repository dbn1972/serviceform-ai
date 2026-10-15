import type { FastifyInstance } from 'fastify';

/**
 * SF-M10-HOST — golden IND-SOC-002 metadata admission only.
 *
 * M10 Wave A admits templates, service packages, fixtures, and E2E harnesses.
 * There are no new Fastify HTTP CMPs to mount: no routes, no domain logic,
 * no statutory/fee/SLA invention. Owner POLICY_INPUT_REQUIRED remains.
 *
 * Hard serial vs SF-M09-HOST (shared `apps/api/src/app.ts` single-writer).
 * CMP-036 remains registered in app.ts — do not remount it here.
 */
export interface M10PluginMounts {
  /**
   * Admit the canonical golden residence catalogue marker on the host.
   * `policyInputRequired` must be `true` — host never invents owner inputs.
   */
  golden?: {
    catalogueId: string;
    policyInputRequired: true;
  };
}

const CANONICAL_CATALOGUE = 'IND-SOC-002';

/**
 * Records M10 metadata admission on the Fastify instance.
 * Mount order: after M09. Returns mounted labels (never empty when golden supplied).
 */
export async function registerM10Plugins(
  _app: FastifyInstance,
  mounts: M10PluginMounts,
): Promise<string[]> {
  const mounted: string[] = [];

  if (mounts.golden) {
    if (mounts.golden.policyInputRequired !== true) {
      throw new Error('SF-M10-HOST: policyInputRequired must be true (no invented owner inputs)');
    }
    if (mounts.golden.catalogueId !== CANONICAL_CATALOGUE) {
      throw new Error(
        `SF-M10-HOST: catalogueId must be ${CANONICAL_CATALOGUE} (got ${mounts.golden.catalogueId})`,
      );
    }
    // No HTTP registration — metadata admission marker only.
    mounted.push('IND-SOC-002');
  }

  return mounted;
}
