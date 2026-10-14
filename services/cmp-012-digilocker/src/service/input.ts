import { Cmp012Error, detail } from '../errors.js';
import { isUuid } from '../domain/simulation.js';

export interface PublishCredentialInput {
  credential_id: string;
  consent_ref: string;
  purpose_code: string;
  document_type_ref: string;
  connector_binding_id?: string;
  test_run_id?: string;
}

const PURPOSE_CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const DOCUMENT_TYPE_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

export function validatePublishInput(body: unknown): PublishCredentialInput {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Cmp012Error('SF-SYS-003', detail('BODY_REQUIRED'));
  }
  const b = body as Record<string, unknown>;

  if (!isUuid(b['credential_id'])) {
    throw new Cmp012Error('SF-SYS-003', detail('UUID_REQUIRED', '/credential_id'));
  }
  if (!isUuid(b['consent_ref'])) {
    throw new Cmp012Error('SF-SYS-003', detail('UUID_REQUIRED', '/consent_ref'));
  }
  if (typeof b['purpose_code'] !== 'string' || !PURPOSE_CODE_RE.test(b['purpose_code'])) {
    throw new Cmp012Error('SF-SYS-003', detail('INVALID_PURPOSE_CODE', '/purpose_code'));
  }
  if (
    typeof b['document_type_ref'] !== 'string' ||
    !DOCUMENT_TYPE_RE.test(b['document_type_ref'])
  ) {
    throw new Cmp012Error('SF-SYS-003', detail('INVALID_DOCUMENT_TYPE_REF', '/document_type_ref'));
  }
  if (b['connector_binding_id'] !== undefined && !isUuid(b['connector_binding_id'])) {
    throw new Cmp012Error('SF-SYS-003', detail('UUID_REQUIRED', '/connector_binding_id'));
  }
  if (b['test_run_id'] !== undefined) {
    if (typeof b['test_run_id'] !== 'string' || b['test_run_id'].length > 128) {
      throw new Cmp012Error('SF-SYS-003', detail('INVALID_TEST_RUN_ID', '/test_run_id'));
    }
  }

  return {
    credential_id: b['credential_id'] as string,
    consent_ref: b['consent_ref'] as string,
    purpose_code: b['purpose_code'] as string,
    document_type_ref: b['document_type_ref'] as string,
    ...(b['connector_binding_id'] !== undefined
      ? { connector_binding_id: b['connector_binding_id'] as string }
      : {}),
    ...(b['test_run_id'] !== undefined ? { test_run_id: b['test_run_id'] as string } : {}),
  };
}
