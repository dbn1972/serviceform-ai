export interface GrantPayload {
  status: 'APPROVED';
  approved_by: string;
  grantee_user_id: string;
  tenant_id: string;
  starts_at: string;
  expires_at: string;
  scope_actions: string[];
  scope_resource_types: string[];
}

export class GrantPublisher {
  constructor(
    private readonly opaUrl: string,
    private readonly token: string,
  ) {}

  async push(tenantId: string, userId: string, grant: GrantPayload): Promise<void> {
    const url = new URL(`/v1/data/sf_runtime/privileged_grants/${tenantId}/${userId}`, this.opaUrl);
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify(grant),
      redirect: 'error',
    });
    if (!res.ok) throw new Error('grant push failed');
  }

  async remove(tenantId: string, userId: string): Promise<void> {
    const url = new URL(`/v1/data/sf_runtime/privileged_grants/${tenantId}/${userId}`, this.opaUrl);
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${this.token}` },
      redirect: 'error',
    });
    if (!res.ok && res.status !== 404) throw new Error('grant remove failed');
    const check = await fetch(url, { headers: { authorization: `Bearer ${this.token}` } });
    if (check.ok) {
      const body = (await check.json()) as { result?: unknown };
      if (body.result) throw new Error('grant still present');
    }
  }
}
