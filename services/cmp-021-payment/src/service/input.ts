import { isUuid } from '../domain/uuid.js';
import { Cmp021Error, detail } from '../errors.js';

export interface CreateIntentInput {
  fee_quote_id: string;
  connector_binding_id?: string | undefined;
  test_run_id?: string | undefined;
}

export interface ApplyCallbackInput {
  raw: unknown;
  headers: Record<string, string | string[] | undefined>;
  exactly_once_key: string;
  idempotency_key: string;
}

export function validateCreateIntentInput(body: unknown): CreateIntentInput {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Cmp021Error('SF-SYS-003', detail('INVALID_BODY'));
  }
  const b = body as Record<string, unknown>;
  if ('amount' in b || 'amount_minor' in b || 'currency' in b || 'total_amount_minor' in b) {
    throw new Cmp021Error('SF-SYS-003', detail('CLIENT_SUPPLIED_AMOUNT_FORBIDDEN'));
  }
  if (!isUuid(b['fee_quote_id'])) {
    throw new Cmp021Error('SF-SYS-003', detail('FEE_QUOTE_ID_REQUIRED', '/fee_quote_id'));
  }
  if (b['connector_binding_id'] !== undefined && !isUuid(b['connector_binding_id'])) {
    throw new Cmp021Error(
      'SF-SYS-003',
      detail('CONNECTOR_BINDING_ID_INVALID', '/connector_binding_id'),
    );
  }
  return {
    fee_quote_id: String(b['fee_quote_id']),
    ...(b['connector_binding_id'] !== undefined
      ? { connector_binding_id: String(b['connector_binding_id']) }
      : {}),
    ...(b['test_run_id'] !== undefined ? { test_run_id: String(b['test_run_id']) } : {}),
  };
}

export function validateApplyCallbackInput(
  body: unknown,
  headers: Record<string, string | string[] | undefined>,
): ApplyCallbackInput {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Cmp021Error('SF-SYS-003', detail('INVALID_BODY'));
  }
  const b = body as Record<string, unknown>;
  const exactlyOnceKey = String(b['exactly_once_key'] ?? '');
  const idempotencyKey = String(b['idempotency_key'] ?? '');
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(exactlyOnceKey)) {
    throw new Cmp021Error('SF-SYS-003', detail('EXACTLY_ONCE_KEY_INVALID', '/exactly_once_key'));
  }
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(idempotencyKey)) {
    throw new Cmp021Error('SF-SYS-003', detail('IDEMPOTENCY_KEY_INVALID', '/idempotency_key'));
  }
  return { raw: body, headers, exactly_once_key: exactlyOnceKey, idempotency_key: idempotencyKey };
}
