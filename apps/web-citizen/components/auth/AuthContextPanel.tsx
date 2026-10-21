import { Icon } from '@serviceform/ui-ux4g';

export type ServiceFacts = {
  catalogueId: string;
  serviceName: string;
  fee: string;
  serviceTime: string;
  delivery: string;
};

export type AuthContextPanelProps = {
  variant: 'sign-in' | 'register';
  service: ServiceFacts;
};

const COPY = {
  'sign-in': {
    title: 'Apply, track and receive certificates online',
    lead: 'Sign in once to apply for services, follow each application and keep issued certificates in one place.',
    serviceLabel: 'Continue to apply for',
  },
  register: {
    title: 'One account for all your applications',
    lead: 'Create your account with just your mobile number. There is no password to remember — you sign in with a one-time password.',
    serviceLabel: 'Ready to apply after sign-up',
  },
} as const;

export function AuthContextPanel({ variant, service }: AuthContextPanelProps) {
  const copy = COPY[variant];
  return (
    <aside className="sf-auth-context" aria-labelledby="auth-context-title">
      <div className="sf-auth-context-intro">
        <p className="sf-auth-context-eyebrow ux4g-label-s-strong">Citizen Services Portal</p>
        <h2 id="auth-context-title" className="ux4g-heading-l-strong">
          {copy.title}
        </h2>
        <p className="ux4g-body-m-default">{copy.lead}</p>
      </div>

      <section className="sf-auth-service" aria-labelledby="auth-service-title">
        <div className="sf-auth-service-head">
          <span className="sf-auth-service-mark">
            <Icon name="document" size={22} />
          </span>
          <div>
            <p className="sf-auth-service-label">
              {copy.serviceLabel} · {service.catalogueId}
            </p>
            <h3 id="auth-service-title" className="ux4g-heading-s-strong">
              {service.serviceName}
            </h3>
          </div>
        </div>
        <dl className="sf-auth-facts">
          <div>
            <dt>Fee</dt>
            <dd>{service.fee}</dd>
          </div>
          <div>
            <dt>Service time</dt>
            <dd>{service.serviceTime}</dd>
          </div>
          <div>
            <dt>Delivered to</dt>
            <dd>{service.delivery}</dd>
          </div>
        </dl>
      </section>

      <section className="sf-auth-howto" aria-labelledby="auth-howto-title">
        <h3 id="auth-howto-title" className="ux4g-label-l-strong">
          How it works
        </h3>
        <ol>
          <li>
            <div>
              <strong>Verify your mobile number</strong>
              <span>Sign in securely with a one-time password sent by SMS.</span>
            </div>
          </li>
          <li>
            <div>
              <strong>Apply online</strong>
              <span>
                Fill in the form, attach a supporting document and review before submitting.
              </span>
            </div>
          </li>
          <li>
            <div>
              <strong>Track and receive</strong>
              <span>Follow every step and receive the certificate in DigiLocker (SIMULATED).</span>
            </div>
          </li>
        </ol>
      </section>

      <ul className="sf-auth-trust" aria-label="Keeping your account safe">
        <li>
          <Icon name="shield" />
          <span>Government staff will never ask for your OTP by phone, SMS or email.</span>
        </li>
        <li>
          <Icon name="lock" />
          <span>For your safety, you are signed out automatically after 8 hours.</span>
        </li>
      </ul>
    </aside>
  );
}
