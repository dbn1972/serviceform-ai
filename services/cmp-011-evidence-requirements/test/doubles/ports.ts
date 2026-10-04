import type { BindingPinPort, EvidencePin } from '../../src/ports/binding.js';
import type { ApprovalPort } from '../../src/ports/approval.js';
import type { ConsentAccessPort } from '../../src/ports/consent.js';
import type { DocumentClassificationPort } from '../../src/ports/ocr.js';
import type { UploadedEvidence, UploadedEvidencePort } from '../../src/ports/uploads.js';

export class StaticBindingPins implements BindingPinPort {
  readonly pins = new Map<string, EvidencePin>();
  throws = false;
  calls: { tenant_id: string; binding_id: string }[] = [];

  set(tenantId: string, bindingId: string, pin: EvidencePin): void {
    this.pins.set(`${tenantId}:${bindingId}`, pin);
  }

  async resolveEvidencePin(input: {
    tenant_id: string;
    binding_id: string;
  }): Promise<EvidencePin | null> {
    this.calls.push(input);
    if (this.throws) throw new Error('registry-timeout');
    return this.pins.get(`${input.tenant_id}:${input.binding_id}`) ?? null;
  }
}

export class StaticUploads implements UploadedEvidencePort {
  docs: UploadedEvidence[] = [];
  throws = false;
  calls = 0;

  async listEvidence(): Promise<UploadedEvidence[]> {
    this.calls += 1;
    if (this.throws) throw new Error('upload-down');
    return this.docs;
  }
}

export class StaticClassifier implements DocumentClassificationPort {
  suggestion: { evidence_type_code: string; confidence: number } | null = null;

  async suggest() {
    return this.suggestion;
  }
}

export class ToggleConsent implements ConsentAccessPort {
  allowed = true;
  throws = false;
  calls = 0;

  async check() {
    this.calls += 1;
    if (this.throws) throw new Error('consent-down');
    return { allowed: this.allowed, reason_code: this.allowed ? 'ALLOW' : 'NO_CONSENT' };
  }
}

export class ToggleApproval implements ApprovalPort {
  allow = true;
  throws = false;

  async requireApproved() {
    if (this.throws) throw new Error('approval-down');
    if (!this.allow) throw new Error('not approved');
    return { ok: true as const, request_id: '05100000-0000-4000-8000-000000000051' };
  }
}
