import '@serviceform/ui-ux4g/styles.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'ServiceForm AI - Service Design Studio',
  description:
    'ServiceForm Studio surface: no-code service, form, rules, workflow and access authoring (built from M03 onward).',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
