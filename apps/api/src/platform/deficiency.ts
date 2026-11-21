import { randomUUID } from 'node:crypto';
import type {
  AuthzDecisionInput,
  AuthzDecisionOutput,
  RequestContext,
} from '@serviceform/contracts';
import type { PgCaseStore } from '@serviceform/cmp-015-application-case';
import type { CaseServiceLike, ServiceResultLike } from './issuance.js';

/**
 * SAMPLE_LAB CMP-019 host adapters (SF-47). Composition only: CaseCommandPort → CMP-015,
 * owner enrichment for citizen DeficiencyNotice authz, Unbound SLA/notification OK in lab.
 * CERTIFIED=false. G6=false.
 */

export interface CaseCommand {
  command: 'RAISE_DEFICIENCY' | 'RECORD_CITIZEN_RESPONSE';
  expected_state: string;
  expected_version: number;
  reason_code: string | null;
}

export interface CaseCommandResult {
  application_id: string;
  state: string;
  aggregate_version: number;
}

export interface CaseCommandPort {
  executeCommand(
    ctx: RequestContext,
    applicationId: string,
    body: CaseCommand,
    idempotencyKey: string,
  ): Promise<CaseCommandResult>;
}

export interface AuthorizationPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

type CaseBody = {
  application?: {
    application_id: string;
    state: string;
    aggregate_version: number;
  };
  error_code?: string;
  details?: { code?: string; pointer?: string }[];
  message?: string;
};

/** Bridges CMP-019 CaseCommandPort to CMP-015 executeCommand (never writes case tables itself). */
export class LabCaseCommandPort implements CaseCommandPort {
  constructor(private readonly cases: CaseServiceLike) {}

  async executeCommand(
    ctx: RequestContext,
    applicationId: string,
    body: CaseCommand,
    idempotencyKey: string,
  ): Promise<CaseCommandResult> {
    const res: ServiceResultLike = await this.cases.executeCommand(
      ctx,
      applicationId,
      {
        command: body.command,
        expected_state: body.expected_state,
        expected_version: body.expected_version,
        ...(body.reason_code ? { reason_code: body.reason_code } : {}),
      },
      idempotencyKey,
    );
    const payload = (res.body ?? {}) as CaseBody;
    if (res.status !== 200 || !payload.application) {
      const detail = payload.details?.[0];
      throw Object.assign(new Error(payload.message ?? 'case command failed'), {
        name: 'Cmp015Error',
        code: payload.error_code ?? 'SF-SYS-004',
        statusCode: res.status,
        details: detail
          ? [{ code: detail.code ?? 'CASE_PORT_DOWN', pointer: detail.pointer }]
          : [{ code: 'CASE_PORT_DOWN' }],
      });
    }
    return {
      application_id: payload.application.application_id,
      state: payload.application.state,
      aggregate_version: payload.application.aggregate_version,
    };
  }
}

/**
 * For citizen DEFICIENCY_* on DeficiencyNotice, inject owner_id from the CMP-015 case
 * (applicant_id) so OPA citizen_owner_permits can fail closed. Officers use the role path.
 */
export function deficiencyOwnerEnrichingAuthorizer(
  pdp: AuthorizationPort,
  store: PgCaseStore,
  cellId: string,
): AuthorizationPort {
  return {
    async decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput> {
      const resource = input.resource;
      const subject = input.subject;
      if (
        resource.resource_type !== 'DeficiencyNotice' ||
        subject.actor_type !== 'CITIZEN' ||
        typeof resource.application_id !== 'string' ||
        !subject.tenant_id ||
        resource.owner_id
      ) {
        return pdp.decide(input);
      }
      const applicantId = await readApplicantId(store, {
        tenantId: subject.tenant_id,
        cellId,
        actorId: subject.user_id,
        applicationId: resource.application_id,
      });
      if (!applicantId) return pdp.decide(input);
      return pdp.decide({
        ...input,
        resource: { ...resource, owner_id: applicantId },
      });
    },
  };
}

async function readApplicantId(
  store: PgCaseStore,
  opts: { tenantId: string; cellId: string; actorId: string; applicationId: string },
): Promise<string | null> {
  try {
    const row = await store.withTx(
      {
        tenantId: opts.tenantId,
        cellId: opts.cellId,
        actorType: 'SYSTEM',
        actorId: opts.actorId,
        correlationId: randomUUID(),
      },
      (tx) => tx.getCase(opts.applicationId),
    );
    return row?.applicant_id ?? null;
  } catch {
    return null;
  }
}
