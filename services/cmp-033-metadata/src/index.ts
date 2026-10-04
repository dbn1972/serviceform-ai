export {
  registerMetadata,
  metadataPlugin,
  authorize,
  denyAllAuthz,
  type AuthorizationPort,
  type SchemaRegistryPort,
  type MetadataPluginOptions,
} from './plugin.js';
export { loadConfig, type MetadataServiceConfig } from './config.js';
export { Cmp033Error, mapPgError } from './errors.js';
export { SimulatedSchemaRegistry, failingSchemaRegistry } from './ports/schema-registry.js';
export { TOPIC_DOMAIN, envelopeOf, insertOutbox } from './db/outbox.js';
