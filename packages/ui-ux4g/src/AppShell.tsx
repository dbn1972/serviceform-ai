import type { CSSProperties, ReactNode } from 'react';
import type { TenantOverlay } from './tenant-overlay';

export type Surface =
  'citizen_web' | 'officer_workbench' | 'service_studio' | 'tenant_admin' | 'platform_ops';

export type AppShellProps = {
  surface: Surface;
  /** Product surface title shown in the banner. */
  title: string;
  children: ReactNode;
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
        <p className="ux4g-label-l-strong sf-product">
          ServiceForm AI <span className="sf-surface">{title}</span>
        </p>
      </header>
      <main id={MAIN_CONTENT_ID} className="sf-main" tabIndex={-1}>
        {children}
      </main>
      <footer className="ux4g-footer-wrapper sf-footer">
        <p className="ux4g-body-m-default">UX4G Design System 3.0</p>
      </footer>
    </div>
  );
}
