import '@serviceform/ui-ux4g/styles.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'ServiceForm AI - Citizen Portal',
  description:
    'Citizen web surface: service discovery, applications, status and credentials (built from M02 onward).',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
