import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * Emits a self-contained server plus only the node_modules actually reachable
   * from it, which is what lets the container image skip a full `npm ci` and drop
   * from hundreds of megabytes to tens.
   */
  output: 'standalone',

  /**
   * There is deliberately no `rewrites()` entry for the API here.
   *
   * Rewrites are resolved when the config is built and baked into the standalone
   * output, so an image built without API_PROXY_TARGET set ships a hardcoded
   * localhost — which inside a container points at the container itself. The proxy
   * is a route handler instead (src/app/api/[...path]/route.ts), which reads the
   * environment per request and keeps one image portable.
   */
};

export default nextConfig;
