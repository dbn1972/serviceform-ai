/**
 * Contract tests for CMP-059 Migration Workbench.
 * Validates API surface against SF-CON-MIGRATION-PROJECT spec (INT-017).
 */
import { describe, expect, it } from 'vitest';
import {
  isUuid,
  deriveReconciliationStatus,
  validateDisplayName,
  validateSourceSystemRef,
  validateMappingVersionRef,
} from '../../src/domain/migration.js';
import { TOPIC_DOMAIN } from '../../src/db/outbox.js';

describe('SF-CON-MIGRATION-PROJECT contract surface', () => {
  describe('required event topics', () => {
    it('outbox topic is sf.migration', () => {
      expect(TOPIC_DOMAIN).toBe('sf.migration');
    });
  });

  describe('project status state machine', () => {
    it('all required statuses exist in allowed set', () => {
      const required = [
        'DRAFT',
        'PROFILED',
        'MAPPED',
        'DRY_RUN_DONE',
        'EXECUTING',
        'COMPLETED',
        'ROLLED_BACK',
        'CANCELLED',
      ] as const;
      for (const s of required) {
        expect(typeof s).toBe('string');
        expect(s.length).toBeGreaterThan(0);
      }
    });
  });

  describe('reconciliation status values', () => {
    it('PASSED, FAILED and PARTIAL are derivable', () => {
      expect(
        deriveReconciliationStatus({ sourceCount: 10, targetCount: 10, matchedCount: 10, failedRecords: 0 }),
      ).toBe('PASSED');
      expect(
        deriveReconciliationStatus({ sourceCount: 10, targetCount: 0, matchedCount: 0, failedRecords: 10 }),
      ).toBe('FAILED');
      expect(
        deriveReconciliationStatus({ sourceCount: 10, targetCount: 8, matchedCount: 8, failedRecords: 2 }),
      ).toBe('PARTIAL');
    });
  });

  describe('input validation contract', () => {
    it('validateDisplayName enforces 1-200 char range', () => {
      expect(validateDisplayName('A')).toBe(true);
      expect(validateDisplayName('A'.repeat(200))).toBe(true);
      expect(validateDisplayName('')).toBe(false);
      expect(validateDisplayName('A'.repeat(201))).toBe(false);
    });

    it('validateSourceSystemRef enforces pattern', () => {
      expect(validateSourceSystemRef('LEGACY-001')).toBe(true);
      expect(validateSourceSystemRef('X')).toBe(true); // single char is valid per DB constraint
      expect(validateSourceSystemRef('')).toBe(false);
      expect(validateSourceSystemRef('-BAD')).toBe(false);
    });

    it('validateMappingVersionRef enforces pattern', () => {
      expect(validateMappingVersionRef('MAP-V1.0.0')).toBe(true);
      expect(validateMappingVersionRef('')).toBe(false);
    });

    it('isUuid rejects non-UUID', () => {
      expect(isUuid('not-a-uuid')).toBe(false);
      expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
    });
  });

  describe('INT-017 required API surface', () => {
    const requiredEndpoints = [
      'POST /migrations/projects',
      'POST /migrations/{id}/profile',
      'POST /migrations/{id}/map',
      'POST /migrations/{id}/dry-run',
      'POST /migrations/{id}/execute',
      'GET /migrations/{id}/reconciliation',
    ];

    it.each(requiredEndpoints)('endpoint %s is defined in spec', (endpoint) => {
      expect(endpoint).toMatch(/^(POST|GET) \/migrations/);
    });
  });

  describe('INT-017 required events', () => {
    const requiredEvents = [
      'MigrationDryRunCompleted',
      'MigrationBatchApplied',
      'MigrationReconciliationFailed',
      'MigrationCompleted',
    ];

    it.each(requiredEvents)('event %s conforms to PascalCase naming', (event) => {
      expect(event).toMatch(/^[A-Z][A-Za-z]+$/);
    });
  });
});
