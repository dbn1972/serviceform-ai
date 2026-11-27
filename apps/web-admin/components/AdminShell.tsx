import { AppShell, type AppShellProps } from '@serviceform/ui-ux4g';
import { AdminNav } from './AdminNav';

type AdminShellProps = Omit<AppShellProps, 'surface' | 'nav' | 'environmentLabel'> & {
  /** Defaults to SAMPLE_LAB — keep one env tag in the header chrome. */
  environmentLabel?: string;
};

/**
 * Tenant admin page frame: horizontal AdminNav in AppShell header + SAMPLE_LAB env tag.
 * Do not render AdminNav inside main.
 */
export function AdminShell({
  children,
  title,
  environmentLabel = 'SAMPLE_LAB',
  ...rest
}: AdminShellProps) {
  return (
    <AppShell
      surface="tenant_admin"
      title={title}
      environmentLabel={environmentLabel}
      nav={<AdminNav />}
      {...rest}
    >
      {children}
    </AppShell>
  );
}
