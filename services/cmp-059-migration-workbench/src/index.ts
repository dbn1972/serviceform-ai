export {
  registerMigration,
  migrationPlugin,
  authorize,
  denyAllAuthz,
  type AuthorizationPort,
  type MigrationPluginOptions,
} from './plugin.js';
export { loadConfig, type MigrationConfig } from './config.js';
export { Cmp059Error, mapPgError } from './errors.js';
export { TOPIC_DOMAIN, envelopeOf, insertOutbox } from './db/outbox.js';
export {
  toMigrationProjectContract,
  CONTRACT_ID,
  type MigrationProjectContract,
} from './domain/contract.js';
