'use client';

import { Icon } from '@serviceform/ui-ux4g';
import { useCitizen } from './RequireCitizenSession';

/** Reminds the citizen which verified account an application will be filed under. */
export function VerifiedAsNote() {
  const citizen = useCitizen();
  return (
    <p className="sf-auth-privacy" data-testid="verified-as">
      <Icon name="shield" size={16} />
      <span>
        Applying as <strong>{citizen.display_name}</strong> ({citizen.masked_mobile}, verified by
        OTP). Your name and mobile are pre-filled.
      </span>
    </p>
  );
}
