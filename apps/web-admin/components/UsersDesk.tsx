'use client';

import { Alert, Button, Checkbox, Select, TextInput } from '@serviceform/ui-ux4g';
import { useCallback, useEffect, useState } from 'react';

interface TenantUser {
  user_id: string;
  username: string;
  display_name: string;
  email: string | null;
  enabled: boolean;
  roles: string[];
  tenant_id: string;
}

interface AdapterMeta {
  adapter_mode?: 'SIMULATED' | 'KEYCLOAK';
  simulation?: boolean;
  certified?: boolean;
  g6_issued?: boolean;
  adr_0007_accepted?: boolean;
  error_code?: string;
  message?: string;
}

export function UsersDesk() {
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [adapter, setAdapter] = useState<AdapterMeta | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [rolePick, setRolePick] = useState('');
  const [assignedRoles, setAssignedRoles] = useState<string[]>([]);

  const load = useCallback(async () => {
    setError('');
    const [metaRes, rolesRes, listRes] = await Promise.all([
      fetch('/api/platform/admin/tenant-users/meta/adapter', { cache: 'no-store' }),
      fetch('/api/platform/admin/tenant-users/meta/roles', { cache: 'no-store' }),
      fetch('/api/platform/admin/tenant-users', { cache: 'no-store' }),
    ]);
    if (metaRes.status === 401 || rolesRes.status === 401 || listRes.status === 401) {
      setError('Sign in as TENANT_ADMIN_STUDIO (Session).');
      return;
    }
    const meta = (await metaRes.json()) as AdapterMeta;
    if (!metaRes.ok) {
      setError(meta.error_code ?? 'SF-AUTH-002');
      return;
    }
    setAdapter(meta);
    const rolesBody = (await rolesRes.json()) as { roles?: string[]; error_code?: string };
    if (!rolesRes.ok) {
      setError(rolesBody.error_code ?? 'SF-AUTH-002');
      return;
    }
    setRoles(rolesBody.roles ?? []);
    const listBody = (await listRes.json()) as { users?: TenantUser[]; error_code?: string };
    if (!listRes.ok) {
      setError(listBody.error_code ?? 'SF-AUTH-002');
      return;
    }
    setUsers(listBody.users ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function selectUser(user: TenantUser) {
    setSelectedId(user.user_id);
    setUsername(user.username);
    setDisplayName(user.display_name);
    setEmail(user.email ?? '');
    setEnabled(user.enabled);
    setAssignedRoles([...user.roles]);
    setRolePick(user.roles[0] ?? roles[0] ?? '');
    setStatus('');
    setError('');
  }

  function resetForm() {
    setSelectedId('');
    setUsername('');
    setDisplayName('');
    setEmail('');
    setEnabled(true);
    setAssignedRoles([]);
    setRolePick(roles[0] ?? '');
    setStatus('');
    setError('');
  }

  async function createUser() {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const res = await fetch('/api/platform/admin/tenant-users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username,
          display_name: displayName,
          email: email || null,
          enabled,
          roles: assignedRoles,
        }),
      });
      const body = (await res.json()) as { error_code?: string; user?: TenantUser };
      if (!res.ok) {
        setError(body.error_code ?? 'SF-SYS-003');
        return;
      }
      setStatus(`Created user ${body.user?.user_id ?? ''}`);
      await load();
      if (body.user) selectUser(body.user);
    } finally {
      setBusy(false);
    }
  }

  async function updateUser() {
    if (!selectedId) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const res = await fetch(`/api/platform/admin/tenant-users/${selectedId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName,
          email: email || null,
          enabled,
        }),
      });
      const body = (await res.json()) as { error_code?: string; user?: TenantUser };
      if (!res.ok) {
        setError(body.error_code ?? 'SF-SYS-003');
        return;
      }
      setStatus(`Updated user ${selectedId}`);
      await load();
      if (body.user) selectUser(body.user);
    } finally {
      setBusy(false);
    }
  }

  async function saveRoles() {
    if (!selectedId) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const res = await fetch(`/api/platform/admin/tenant-users/${selectedId}/roles`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roles: assignedRoles }),
      });
      const body = (await res.json()) as { error_code?: string; user?: TenantUser };
      if (!res.ok) {
        setError(body.error_code ?? 'SF-SYS-003');
        return;
      }
      setStatus(`Roles updated for ${selectedId}`);
      await load();
      if (body.user) selectUser(body.user);
    } finally {
      setBusy(false);
    }
  }

  function addRole() {
    if (!rolePick || assignedRoles.includes(rolePick)) return;
    setAssignedRoles([...assignedRoles, rolePick]);
  }

  function removeRole(role: string) {
    setAssignedRoles(assignedRoles.filter((r) => r !== role));
  }

  const modeLabel =
    adapter?.adapter_mode === 'KEYCLOAK'
      ? 'KEYCLOAK (Admin REST API — console not embedded)'
      : 'SIMULATED (lab adapter; same Admin BFF contract)';

  return (
    <div className="sf-stack">
      <p className="ux4g-body-m-default">
        M02 identity admin surface for this tenant only. Ops are scoped by the CMP-004 session
        tenant binding (never a client-supplied tenant). Fail-closed OPA · CERTIFIED=false ·
        G6=false · ADR-0007 not claimed accepted.
      </p>
      {adapter ? (
        <Alert variant="info" title="Directory adapter">
          {modeLabel}. simulation={String(adapter.simulation === true)} ·
          adr_0007_accepted={String(adapter.adr_0007_accepted === true)} ·
          production_idp_claimed=false
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="error" title="Users request failed">
          {error}
        </Alert>
      ) : null}
      {status ? (
        <Alert variant="success" title="Users">
          {status}
        </Alert>
      ) : null}

      <div className="sf-actions">
        <Button
          variant="outline-primary"
          disabled={busy}
          onClick={() => {
            void load();
          }}
        >
          Refresh
        </Button>
        <Button variant="text-neutral" disabled={busy} onClick={resetForm}>
          New user
        </Button>
      </div>

      <ul className="sf-list" aria-label="Tenant workforce users">
        {users.length === 0 ? (
          <li className="ux4g-body-m-default">No users in this tenant directory yet.</li>
        ) : (
          users.map((user) => (
            <li key={user.user_id}>
              <button
                type="button"
                className="ux4g-text-link-md"
                onClick={() => selectUser(user)}
              >
                {user.username} · {user.enabled ? 'enabled' : 'disabled'} · roles{' '}
                {user.roles.length}
              </button>
            </li>
          ))
        )}
      </ul>

      <TextInput
        id="username"
        name="username"
        label="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
        disabled={Boolean(selectedId)}
      />
      <TextInput
        id="display_name"
        name="display_name"
        label="Display name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        required
      />
      <TextInput
        id="email"
        name="email"
        label="Email (optional)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Checkbox
        id="enabled"
        name="enabled"
        label="Enabled"
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
      />

      <div className="sf-actions">
        {selectedId ? (
          <Button
            disabled={busy}
            onClick={() => {
              void updateUser();
            }}
          >
            Update user
          </Button>
        ) : (
          <Button
            disabled={busy}
            onClick={() => {
              void createUser();
            }}
          >
            Add user
          </Button>
        )}
      </div>

      <Select
        id="role_pick"
        name="role_pick"
        label="Role catalogue"
        value={rolePick}
        onChange={(e) => setRolePick(e.target.value)}
        placeholder="Select a role"
        options={roles.map((r) => ({ value: r, label: r }))}
      />
      <div className="sf-actions">
        <Button variant="outline-primary" disabled={busy || !rolePick} onClick={addRole}>
          Add role to selection
        </Button>
        <Button
          disabled={busy || !selectedId}
          onClick={() => {
            void saveRoles();
          }}
        >
          Assign roles
        </Button>
      </div>
      <ul className="sf-list" aria-label="Selected roles">
        {assignedRoles.length === 0 ? (
          <li className="ux4g-body-m-default">No roles selected.</li>
        ) : (
          assignedRoles.map((role) => (
            <li key={role}>
              {role}{' '}
              <button type="button" className="ux4g-text-link-md" onClick={() => removeRole(role)}>
                Remove
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
