import { platform, type Officer, type PlatformResponse } from './platform';

export { DESK_LABELS, deskActionsForRole, deskRoles, type DeskAction } from './desk';

/** CMP-017 human-task projection for the officer workbench (SAMPLE_LAB multi-desk). */
export interface WorkbenchTask {
  task_id: string;
  application_id: string;
  workflow_node_id?: string;
  task_state: string;
  assignment: {
    role_code: string;
    organisation_id: string;
    jurisdiction_id: string;
    office_id?: string;
    claimed_principal_id?: string;
  };
  aggregate_version: number;
  created_at: string;
  updated_at: string;
}

export async function listAvailableTasks(
  officer: Officer,
): Promise<{ ok: true; tasks: WorkbenchTask[] } | { ok: false; res: PlatformResponse }> {
  const res = await platform('GET', '/v1/tasks/available?limit=100', { token: officer.token });
  if (res.status !== 200) return { ok: false, res };
  const items = (res.body['items'] ?? []) as WorkbenchTask[];
  return { ok: true, tasks: Array.isArray(items) ? items : [] };
}

export async function claimTask(
  officer: Officer,
  taskId: string,
): Promise<{ ok: true; task: WorkbenchTask } | { ok: false; res: PlatformResponse }> {
  const res = await platform('POST', `/v1/tasks/${taskId}/claim`, {
    token: officer.token,
    idempotent: true,
    body: {},
  });
  const task = res.body as unknown as WorkbenchTask;
  return res.status === 200 && task?.task_id ? { ok: true, task } : { ok: false, res };
}
