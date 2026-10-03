import type { ReactNode } from 'react';

export type Surface =
  'citizen_web' | 'officer_workbench' | 'service_studio' | 'tenant_admin' | 'platform_ops';

export interface AppShellProps {
  surface: Surface;
  /** Product surface title shown in the banner. */
  title: string;
  children: ReactNode;
}

export const MAIN_CONTENT_ID = 'main-content';

/**
 * Accessible page frame shared by every web surface: skip link, banner, main and contentinfo
 * landmarks. Carries no visual design values (see README, gap G-03).
 */
export function AppShell({ surface, title, children }: AppShellProps) {
  return (
    <div className="sf-app" data-surface={surface}>
      <a className="sf-skip-link" href={`#${MAIN_CONTENT_ID}`}>
        Skip to main content
      </a>
      <header className="sf-header">
        <p className="sf-product">
          ServiceForm AI <span className="sf-surface">{title}</span>
        </p>
      </header>
      <main id={MAIN_CONTENT_ID} className="sf-main" tabIndex={-1}>
        {children}
      </main>
      <footer className="sf-footer">
        <p>Bootstrap shell. No services are available yet.</p>
      </footer>
    </div>
  );
}
