import type { NextConfig } from 'next';
import { securityHeaders } from '@serviceform/ui-ux4g/security-headers';

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@serviceform/ui-ux4g', '@serviceform/m10-sample-lab'],
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders(process.env.NODE_ENV === 'development') },
    ];
  },
};

export default config;
