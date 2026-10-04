import { Cmp050Error } from './errors.js';
import type { PortalSession } from './session.js';

export type PublicationStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export type PublicationRequestView = {
  request_id: string;
  status: PublicationStatus;
  maker_principal_id: string;
  checker_principal_id?: string | null;
};

export type MakerCheckerUx = {
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  reason: string;
};

const CHECKER_ROLES = new Set(['STUDIO_CHECKER', 'TENANT_ADMIN', 'PLATFORM_OPS']);
const MAKER_ROLES = new Set(['STUDIO_DESIGNER', 'TENANT_ADMIN', 'PLATFORM_OPS']);

export function makerCheckerUx(
  session: PortalSession,
  request: PublicationRequestView,
): MakerCheckerUx {
  const isMaker = session.actor_id === request.maker_principal_id;
  const hasMakerRole = session.roles.some((r) => MAKER_ROLES.has(r));
  const hasCheckerRole = session.roles.some((r) => CHECKER_ROLES.has(r));

  if (request.status === 'DRAFT') {
    const canSubmit = isMaker && hasMakerRole;
    return {
      canSubmit,
      canApprove: false,
      canReject: false,
      reason: canSubmit ? 'READY_TO_SUBMIT' : 'MAKER_REQUIRED',
    };
  }
  if (request.status === 'SUBMITTED') {
    if (isMaker) {
      return {
        canSubmit: false,
        canApprove: false,
        canReject: false,
        reason: 'MAKER_CANNOT_CHECK',
      };
    }
    const canDecide = hasCheckerRole;
    return {
      canSubmit: false,
      canApprove: canDecide,
      canReject: canDecide,
      reason: canDecide ? 'CHECKER_REQUIRED' : 'CHECKER_ROLE_REQUIRED',
    };
  }
  return {
    canSubmit: false,
    canApprove: false,
    canReject: false,
    reason: 'DECISION_IMMUTABLE',
  };
}

export function assertCheckerIsNotMaker(
  session: PortalSession,
  request: PublicationRequestView,
): void {
  if (session.actor_id === request.maker_principal_id) {
    throw new Cmp050Error('SF-AUTH-002', { details: [{ code: 'MAKER_CANNOT_CHECK' }] });
  }
}
