import type { ReactNode } from 'react';

export type AuthLayoutProps = {
  children: ReactNode;
  context: ReactNode;
  /** Synthetic credentials hint for the SAMPLE_LAB environment strip. */
  sampleHint?: ReactNode;
};

/** UX4G Identity & Access composition: form box with an informational side pane. */
export function AuthLayout({ children, context, sampleHint }: AuthLayoutProps) {
  return (
    <div className="sf-auth">
      <div className="sf-auth-card">
        <div className="sf-auth-main">
          <div className="ux4g-form-box ux4g-bg-neutral-elevated">{children}</div>
        </div>
        {context}
      </div>
      <p className="sf-auth-env" data-testid="lab-environment-note">
        <span className="ux4g-tag-tonal-warning">SAMPLE_LAB</span>
        <span>
          Simulated OTP and DigiLocker · synthetic data only · not production identity · G6 not
          issued
        </span>
        {sampleHint ? <span>{sampleHint}</span> : null}
      </p>
    </div>
  );
}
