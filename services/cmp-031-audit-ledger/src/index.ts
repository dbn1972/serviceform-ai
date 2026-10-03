export { cmp031AuditLedgerPlugin, registerAuditPlugin, type AuditPluginOptions } from './plugin.js';
export { handleEnvelope } from './consumer/handle-envelope.js';
export { appendLedger } from './domain/ledger-writer.js';
export { verifyTenantChain, verifyPlatformChain } from './domain/verify-chain.js';
export { denyAllAuthz, type AuthzPort } from './ports/authz-port.js';
export { withTenantTx } from './repo/tx.js';
