import { DESK_LABELS, deskRoles, listAvailableTasks } from '../../../../lib/portal/tasks';
import {
  currentOfficer,
  json,
  relay,
  tenantIdentifyingRefusal,
} from '../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CMP-017 available HUMAN_TASK queue for the signed-in officer's roles (fail-closed OPA TASK_LIST).
 * Desk groupings are role_code labels from the Studio workflow graph — never named officers.
 * SF-TEN-002: client must not name tenant / roles (P8-5 ops depth).
 */
export async function GET(request: Request) {
  const tenancy = tenantIdentifyingRefusal(request);
  if (tenancy) return tenancy;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const listed = await listAvailableTasks(officer);
  if (!listed.ok) return relay(listed.res);
  const roles = deskRoles(officer.roles);
  const desks = roles.map((role_code) => ({
    role_code,
    label: DESK_LABELS[role_code] ?? role_code,
    open_count: listed.tasks.filter((t) => t.assignment.role_code === role_code).length,
  }));
  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    desks,
    roles: officer.roles,
    tasks: listed.tasks,
  });
}
