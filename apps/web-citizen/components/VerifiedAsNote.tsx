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
        Applying as <strong>{citizen.display_name}</strong>
        {citizen.masked_mobile ? ` (${citizen.masked_mobile})` : ''}, signed in with OTP. Details
        from your profile are pre-filled; check them before you continue.
      </span>
    </p>
  );
}
