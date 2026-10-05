import { TaskService } from '../../src/service/task-service.js';
import type { Idempotency } from '../../src/service/task-service.js';
import type { TenantContext } from '../../src/context.js';
import { requestFingerprint } from '../../src/domain/fingerprint.js';
import { ScriptedAuthorizer } from './authorizer.js';
import { idemKey } from './fixtures.js';
import { MemoryTaskRepository } from './memory-repo.js';
import { ScriptedScope } from './scope.js';

export function makeService() {
  const repo = new MemoryTaskRepository();
  const authz = new ScriptedAuthorizer();
  const scopes = new ScriptedScope();
  let tick = 0;
  let idSeq = 5000;
  const clock = () => new Date(Date.UTC(2026, 9, 5, 12, 0, tick++));
  const newId = () => `00000000-0000-4000-8000-${String(idSeq++).padStart(12, '0')}`;
  const service = new TaskService({ repo, authz, scopes, clock, newId });
  return { service, repo, authz, scopes };
}

export function idem(endpoint: string, body: unknown = null, key: string = idemKey()): Idempotency {
  return { key, endpoint, fingerprint: requestFingerprint('POST', endpoint, body) };
}

export type Ctx = TenantContext;
