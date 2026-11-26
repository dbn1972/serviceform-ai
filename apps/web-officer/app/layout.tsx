import '@serviceform/ui-ux4g/styles.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'ServiceForm AI - Officer Workbench',
  description:
    'Officer workbench surface: work queue, scrutiny, verification and decisions (built from M05 onward).',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
