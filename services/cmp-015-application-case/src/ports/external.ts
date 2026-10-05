import { Cmp015Error, detail } from '../errors.js';

/**
 * Payment (M06/CMP-021), notification (M06/CMP-025) and DigiLocker (M07) are PORTS ONLY in M05.
 * No provider is implemented here. Every port is guarded against use inside a domain transaction.
 */
export interface PaymentPort {
  requestPaymentIntent(params: {
    tenant_id: string;
    application_id: string;
    fee_policy_version_id: string;
    idempotency_key: string;
  }): Promise<{ payment_intent_ref: string }>;
}

export interface NotificationPort {
  requestNotification(params: {
    tenant_id: string;
    application_id: string;
    template_ref: string;
    idempotency_key: string;
  }): Promise<{ notification_ref: string }>;
}

export interface DigiLockerPort {
  requestDocumentPull(params: {
    tenant_id: string;
    application_id: string;
    document_type_code: string;
    idempotency_key: string;
  }): Promise<{ pull_ref: string }>;
}

function unconfigured(port: string): never {
  throw new Cmp015Error('SF-SYS-004', { details: detail(`${port}_PORT_NOT_CONFIGURED`) });
}

export const unconfiguredPaymentPort: PaymentPort = {
  async requestPaymentIntent() {
    return unconfigured('PAYMENT');
  },
};

export const unconfiguredNotificationPort: NotificationPort = {
  async requestNotification() {
    return unconfigured('NOTIFICATION');
  },
};

export const unconfiguredDigiLockerPort: DigiLockerPort = {
  async requestDocumentPull() {
    return unconfigured('DIGILOCKER');
  },
};
