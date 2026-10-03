import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, '../../..');

export const paths = {
  cmp002OpenApi: join(REPO_ROOT, 'services/cmp-002-tenant-organisation/contracts/openapi.json'),
  cmp002AsyncApi: join(REPO_ROOT, 'services/cmp-002-tenant-organisation/contracts/asyncapi.json'),
  cmp002Topics: join(REPO_ROOT, 'services/cmp-002-tenant-organisation/contracts/topics.json'),
  cmp002EventsDir: join(REPO_ROOT, 'services/cmp-002-tenant-organisation/contracts/events'),
  cmp031Topics: join(REPO_ROOT, 'services/cmp-031-audit-ledger/contracts/topics.json'),
  cmp037Topics: join(REPO_ROOT, 'services/cmp-037-integration-hub/contracts/topics.json'),
  cmp037EventsDir: join(REPO_ROOT, 'services/cmp-037-integration-hub/contracts/events'),
  cmp048Topics: join(REPO_ROOT, 'services/cmp-048-security-platform/contracts/topics.json'),
  cmp048EventsDir: join(REPO_ROOT, 'services/cmp-048-security-platform/contracts/events'),
  cmp038Registry: join(REPO_ROOT, 'services/cmp-038-event-bus/registry/topics.json'),
  outboxSnapshot: join(REPO_ROOT, 'packages/outbox/src/registry-snapshot.json'),
  auditEventExample: join(REPO_ROOT, 'contracts/shared/examples/valid/audit-event.json'),
  expectationsDir: join(REPO_ROOT, 'tests/cdc/expectations'),
} as const;
