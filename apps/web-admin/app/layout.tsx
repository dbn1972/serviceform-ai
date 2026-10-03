import '@serviceform/ui-ux4g/styles.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'ServiceForm AI - Administration',
  description:
    'Tenant administration and platform operations surface (tenant_admin and platform_ops).',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
