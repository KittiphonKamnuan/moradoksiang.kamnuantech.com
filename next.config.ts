import type { NextConfig } from 'next';

/** Static export: the Rust server (server/) serves ./out and the /api routes. */
const nextConfig: NextConfig = {
  output: 'export',
  poweredByHeader: false,
};

export default nextConfig;
