export { loadConfig, isSimulatedAllowed } from './config.js';
export { checkCompatibility, assertCompatible } from './registry/compatibility.js';
export { syncRegistry } from './registry/service.js';
export { auditThenAct } from './dead-letter/operator-actions.js';
export type { AuthorizationPort, OperatorAction } from './dead-letter/operator-actions.js';
export { recordLag } from './lag/lag-monitor.js';
