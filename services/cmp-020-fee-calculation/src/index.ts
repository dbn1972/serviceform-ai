import { createFeeApi } from './api/handler.js';
import type { AuthorizationPort } from './authz.js';
import type { ContextResolver } from './context.js';
import { Cmp020Error } from './errors.js';
import {
  UnboundApplicationPinsPort,
  type ApplicationPinsPort,
} from './ports/application-pins-port.js';
import { UnboundFeePolicyPort, type FeePolicyPort } from './ports/fee-policy-port.js';
import { UnboundFeeRulesPort, type FeeRulesPort } from './ports/fee-rules-port.js';
import { PgFeeRepository, type SqlPool } from './repo/pg.js';
import type { FeeRepository } from './repo/types.js';
import { FeeService } from './service/service.js';

export interface FeeOptions {
  pool?: SqlPool;
  repository?: FeeRepository;
  resolveContext: ContextResolver;
  authorizer: AuthorizationPort;
  applicationPins?: ApplicationPinsPort;
  feePolicy?: FeePolicyPort;
  feeRules?: FeeRulesPort;
  clock?: () => Date;
}

/** Unbound ports fail closed (SF-SYS-004); no default fee schedule or amount exists. */
export function buildFeeService(opts: Omit<FeeOptions, 'resolveContext'>): FeeService {
  const repo = opts.repository ?? (opts.pool ? new PgFeeRepository(opts.pool) : undefined);
  if (!repo) throw new Cmp020Error('SF-SYS-001', { details: [{ code: 'REPOSITORY_REQUIRED' }] });
  return new FeeService({
    repo,
    authorizer: opts.authorizer,
    applicationPins: opts.applicationPins ?? new UnboundApplicationPinsPort(),
    feePolicy: opts.feePolicy ?? new UnboundFeePolicyPort(),
    feeRules: opts.feeRules ?? new UnboundFeeRulesPort(),
    clock: opts.clock ?? ((): Date => new Date()),
  });
}

export function buildFeeApi(opts: FeeOptions): ReturnType<typeof createFeeApi> {
  return createFeeApi({ service: buildFeeService(opts), resolveContext: opts.resolveContext });
}

export { FeeService } from './service/service.js';
export { createFeeApi, ROUTE_DESCRIPTORS } from './api/handler.js';
export { PgFeeRepository } from './repo/pg.js';
export { calculate, validatePolicy, validateEvaluation } from './domain/calculate.js';
export { feeQuoteView, type FeeQuote } from './domain/quote.js';
export type { SqlClient, SqlPool, SqlResult } from './repo/pg.js';
export type { AuthorizationPort } from './authz.js';
export type { ContextResolver } from './context.js';
export type { ApplicationFeePins, ApplicationPinsPort } from './ports/application-pins-port.js';
export type {
  FeePolicyPort,
  PublishedFeePolicy,
  PublishedFeePolicyLine,
} from './ports/fee-policy-port.js';
export type { FeeRulesEvaluation, FeeRulesPort, FeeRulesRequest } from './ports/fee-rules-port.js';
