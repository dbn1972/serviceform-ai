import { Icon } from '@serviceform/ui-ux4g';
import type { OtpChallenge } from '../../lib/auth-client';

/** Shows what the SIMULATED SMS adapter "sent" — present only because no gateway exists in SAMPLE_LAB. */
export function SimulatedSms({ sms }: { sms: NonNullable<OtpChallenge['simulated_sms']> }) {
  return (
    <div className="sf-auth-sms" role="note" aria-label="Simulated SMS" data-testid="simulated-sms">
      <span className="sf-auth-sms-icon">
        <Icon name="message" size={18} />
      </span>
      <div className="sf-auth-sms-body">
        <p className="sf-auth-sms-head">
          <span className="ux4g-tag-tonal-warning ux4g-tag-s">Simulated SMS</span>
          <span>To {sms.to} · SAMPLE_LAB</span>
        </p>
        <p className="sf-auth-sms-text">
          <span className="sf-auth-sms-code">{sms.code}</span>
          {sms.body.slice(sms.code.length)}
        </p>
      </div>
    </div>
  );
}
