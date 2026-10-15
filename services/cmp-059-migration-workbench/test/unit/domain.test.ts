import { describe, expect, it } from 'vitest';
import {
  isUuid,
  canTransition,
  deriveReconciliationStatus,
  validateDisplayName,
  validateSourceSystemRef,
  validateMappingVersionRef,
} from '../../src/domain/migration.js';

describe('domain invariants', () => {
  describe('isUuid', () => {
    it('accepts valid v4 UUID', () => {
      expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
    });
    it('rejects malformed string', () => {
      expect(isUuid('not-a-uuid')).toBe(false);
    });
  });

  describe('canTransition', () => {
    it('allows MAPPED -> DRY_RUN_DONE', () => {
      expect(canTransition('MAPPED', 'DRY_RUN_DONE')).toBe(true);
    });
    it('allows DRY_RUN_DONE -> EXECUTING', () => {
      expect(canTransition('DRY_RUN_DONE', 'EXECUTING')).toBe(true);
    });
    it('disallows DRAFT -> EXECUTING (bypass dry run)', () => {
      expect(canTransition('DRAFT', 'EXECUTING')).toBe(false);
    });
    it('disallows MAPPED -> EXECUTING (bypass dry run)', () => {
      expect(canTransition('MAPPED', 'EXECUTING')).toBe(false);
    });
  });

  describe('deriveReconciliationStatus', () => {
    it('returns PASSED when no failures and all matched', () => {
      expect(
        deriveReconciliationStatus({
          sourceCount: 100,
          targetCount: 100,
          matchedCount: 100,
          failedRecords: 0,
        }),
      ).toBe('PASSED');
    });
    it('returns FAILED when nothing matched', () => {
      expect(
        deriveReconciliationStatus({
          sourceCount: 100,
          targetCount: 0,
          matchedCount: 0,
          failedRecords: 100,
        }),
      ).toBe('FAILED');
    });
    it('returns PARTIAL when some matched some failed', () => {
      expect(
        deriveReconciliationStatus({
          sourceCount: 100,
          targetCount: 90,
          matchedCount: 90,
          failedRecords: 10,
        }),
      ).toBe('PARTIAL');
    });
  });

  describe('validateDisplayName', () => {
    it('accepts valid name', () => {
      expect(validateDisplayName('Civil Registry Migration')).toBe(true);
    });
    it('rejects empty string', () => {
      expect(validateDisplayName('')).toBe(false);
    });
    it('rejects > 200 chars', () => {
      expect(validateDisplayName('x'.repeat(201))).toBe(false);
    });
  });

  describe('validateSourceSystemRef', () => {
    it('accepts valid ref', () => {
      expect(validateSourceSystemRef('LEGACY-CR-001')).toBe(true);
    });
    it('rejects ref starting with dash', () => {
      expect(validateSourceSystemRef('-BAD')).toBe(false);
    });
  });

  describe('validateMappingVersionRef', () => {
    it('accepts v-prefixed version', () => {
      expect(validateMappingVersionRef('MAP-V1.0.0')).toBe(true);
    });
    it('rejects empty string', () => {
      expect(validateMappingVersionRef('')).toBe(false);
    });
  });
});
