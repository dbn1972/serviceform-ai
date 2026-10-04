import type { ConnectorBinding } from '@serviceform/contracts';
import type { Pool } from 'pg';
import type { AuthorizationPort } from '../authz.js';
import type { EvidenceConfig } from '../config.js';
import type { ApprovalPort } from '../ports/approval.js';
import type { BindingPinPort } from '../ports/binding.js';
import type { ConsentAccessPort } from '../ports/consent.js';
import type { DigiLockerEvidencePort } from '../ports/digilocker.js';
import type { DocumentClassificationPort } from '../ports/ocr.js';
import type { UploadedEvidencePort } from '../ports/uploads.js';

export interface EvidenceDeps {
  pool: Pool;
  authorizer: AuthorizationPort;
  approval: ApprovalPort;
  config: EvidenceConfig;
  clock: () => Date;
  bindingPins: BindingPinPort;
  uploads: UploadedEvidencePort;
  classification?: DocumentClassificationPort;
  consent?: ConsentAccessPort;
  digiLocker?: DigiLockerEvidencePort;
  digiLockerBinding?: ConnectorBinding;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}
