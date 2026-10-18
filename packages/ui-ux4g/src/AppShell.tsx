import type { CSSProperties, ReactNode } from 'react';
import type { TenantOverlay } from './tenant-overlay';

export type Surface =
  | 'citizen_web'
  | 'officer_workbench'
  | 'service_studio'
  | 'tenant_admin'
  | 'platform_ops';

export type AppShellProps = {
  surface: Surface;
  /** Product surface title shown in the banner. */
  title: string;
  children: ReactNode;
  /** Optional primary navigation rendered in the header. */
  nav?: ReactNode;
  /** Optional eyebrow / environment label (e.g. SAMPLE_LAB). */
  environmentLabel?: string;
  tenantId?: string;
  theme?: 'light' | 'dark';
  overlay?: TenantOverlay;
};

export const MAIN_CONTENT_ID = 'main-content';

/**
 * Accessible page frame shared by every web surface: skip link, banner, main and contentinfo
 * landmarks. Visual values come only from vendored UX4G 3.0 tokens/classes.
 */
export function AppShell({
  surface,
  title,
  children,
  nav,
  environmentLabel,
  tenantId,
  theme = 'light',
  overlay,
}: AppShellProps) {
  const scope = overlay?.tenantId ?? tenantId;
  return (
    <div
      className="sf-app"
      data-surface={surface}
      data-theme={theme}
      data-tenant-id={scope}
      style={overlay?.tokens as CSSProperties | undefined}
    >
      <a className="sf-skip-link" href={`#${MAIN_CONTENT_ID}`}>
        Skip to main content
      </a>
      <header className="ux4g-navbar sf-header">
        <div className="ux4g-navbar-wrap sf-header-wrap">
          <div className="sf-brand">
            <span className="sf-brand-mark" aria-hidden="true" />
            <div className="sf-brand-text">
              <p className="ux4g-label-l-strong sf-product">ServiceForm AI</p>
              <p className="ux4g-body-s-default sf-surface">{title}</p>
            </div>
            {environmentLabel ? (
              <span className="ux4g-tag-tonal-warning sf-env-tag">{environmentLabel}</span>
            ) : null}
          </div>
          {nav ? <div className="ux4g-navbar-right sf-header-nav">{nav}</div> : null}
        </div>
      </header>
      <main id={MAIN_CONTENT_ID} className="sf-main" tabIndex={-1}>
        <div className="ux4g-container sf-page">{children}</div>
      </main>
      <footer className="ux4g-footer-wrapper sf-footer">
        <div className="ux4g-container sf-footer-inner">
          <p className="ux4g-body-m-default">UX4G Design System 3.0</p>
          <p className="ux4g-body-s-default sf-footer-note">
            Metadata-driven · multi-tenant · government services
          </p>
        </div>
      </footer>
    </div>
  );
}
