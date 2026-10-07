-- CMP-019 additive durable reconciliation intent (SF-M05-REM-001 / INT-009).
-- Same-transaction intent sufficient to reconstruct CMP-015 case commands and
-- CMP-029 SLA pause/resume after crash. Does NOT alter SF-CON-OUTBOX table shape.
-- Executable consumer lives in services/cmp-019-deficiency (CMP-016-like + inbox).
--
-- Up Migration

-- sf:isolation sf_deficiency.reconciliation_intent TENANT_SCOPED owner=CMP-019
CREATE TABLE sf_deficiency.reconciliation_intent (
  tenant_id uuid NOT NULL,
  intent_id uuid NOT NULL,
  deficiency_id uuid NOT NULL,
  application_id uuid NOT NULL,
  cell_id text NOT NULL CHECK (cell_id ~ '^cell-[a-z0-9-]{1,40}$'),
  correlation_id uuid NOT NULL,
  source_event_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('OPEN', 'RESPOND', 'CLOSE')),
  -- Case command reconstruction (NULL when no case effect for this operation)
  case_command text CHECK (
    case_command IS NULL
    OR case_command IN ('RAISE_DEFICIENCY', 'RECORD_CITIZEN_RESPONSE')
  ),
  case_expected_state text CHECK (
    case_expected_state IS NULL OR char_length(case_expected_state) BETWEEN 1 AND 64
  ),
  case_expected_version bigint CHECK (
    case_expected_version IS NULL OR case_expected_version >= 0
  ),
  case_reason_code text CHECK (
    case_reason_code IS NULL OR case_reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
  ),
  case_idempotency_key text CHECK (
    case_idempotency_key IS NULL OR char_length(case_idempotency_key) BETWEEN 1 AND 128
  ),
  case_effect_status text NOT NULL DEFAULT 'NONE'
    CHECK (case_effect_status IN ('NONE', 'PENDING', 'APPLIED', 'FAILED_STALE', 'FAILED_RETRYABLE')),
  -- SLA pause/resume reconstruction (NULL when no SLA effect)
  sla_kind text CHECK (sla_kind IS NULL OR sla_kind IN ('pause', 'resume')),
  sla_stage_code text CHECK (
    sla_stage_code IS NULL OR sla_stage_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
  ),
  sla_reason_code text CHECK (
    sla_reason_code IS NULL OR sla_reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
  ),
  sla_idempotency_key text CHECK (
    sla_idempotency_key IS NULL OR char_length(sla_idempotency_key) BETWEEN 1 AND 128
  ),
  sla_effect_status text NOT NULL DEFAULT 'NONE'
    CHECK (sla_effect_status IN ('NONE', 'PENDING', 'APPLIED', 'FAILED_RETRYABLE')),
  -- Notification port reconstruction (M06 CMP-025); not authoritative for INT-009 case/SLA
  notification_kind text CHECK (
    notification_kind IS NULL
    OR notification_kind IN ('DEFICIENCY_OPENED', 'DEFICIENCY_RESPONDED', 'DEFICIENCY_CLOSED')
  ),
  notification_effect_status text NOT NULL DEFAULT 'NONE'
    CHECK (notification_effect_status IN ('NONE', 'PENDING', 'APPLIED', 'FAILED_RETRYABLE')),
  last_error_code text CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, intent_id),
  UNIQUE (tenant_id, source_event_id),
  FOREIGN KEY (tenant_id, deficiency_id)
    REFERENCES sf_deficiency.deficiency_notice (tenant_id, deficiency_id),
  CHECK (
    (case_command IS NULL AND case_effect_status = 'NONE')
    OR (
      case_command IS NOT NULL
      AND case_expected_state IS NOT NULL
      AND case_expected_version IS NOT NULL
      AND case_idempotency_key IS NOT NULL
      AND case_effect_status <> 'NONE'
    )
  ),
  CHECK (
    (sla_kind IS NULL AND sla_effect_status = 'NONE')
    OR (
      sla_kind IS NOT NULL
      AND sla_stage_code IS NOT NULL
      AND sla_reason_code IS NOT NULL
      AND sla_idempotency_key IS NOT NULL
      AND sla_effect_status <> 'NONE'
    )
  ),
  CHECK (
    (notification_kind IS NULL AND notification_effect_status = 'NONE')
    OR (notification_kind IS NOT NULL AND notification_effect_status <> 'NONE')
  )
);
CREATE INDEX reconciliation_intent_pending_idx
  ON sf_deficiency.reconciliation_intent (tenant_id, created_at)
  WHERE case_effect_status IN ('PENDING', 'FAILED_RETRYABLE')
     OR sla_effect_status IN ('PENDING', 'FAILED_RETRYABLE')
     OR notification_effect_status IN ('PENDING', 'FAILED_RETRYABLE');
CREATE INDEX reconciliation_intent_deficiency_idx
  ON sf_deficiency.reconciliation_intent (tenant_id, deficiency_id);
ALTER TABLE sf_deficiency.reconciliation_intent ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_deficiency.reconciliation_intent FORCE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_intent_isolation ON sf_deficiency.reconciliation_intent TO sf_app
  USING (tenant_id = sf_platform.current_tenant_id())
  WITH CHECK (tenant_id = sf_platform.current_tenant_id());
ALTER TABLE sf_deficiency.reconciliation_intent OWNER TO sf_migrator;

REVOKE ALL ON TABLE sf_deficiency.reconciliation_intent FROM PUBLIC;
GRANT SELECT, INSERT,
  UPDATE (
    case_effect_status, sla_effect_status, notification_effect_status,
    last_error_code, updated_at
  )
  ON sf_deficiency.reconciliation_intent TO sf_cmp019_rw;

-- Down Migration
DROP TABLE IF EXISTS sf_deficiency.reconciliation_intent;
