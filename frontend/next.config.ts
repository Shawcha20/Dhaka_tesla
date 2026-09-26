import type { NextConfig } from 'next';

/**
 * Where the API actually lives. Server-side only — the browser never sees it,
 * because every request goes through the rewrite below.
 */
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * The API is proxied through this app rather than called directly, and that is a
   * security decision rather than a convenience one.
   *
   * Deployed, the frontend (Vercel) and the API (Render) are different sites. A
   * browser will only attach cookies to cross-site requests when they are marked
   * SameSite=None, which removes exactly the protection SameSite exists to give —
   * so the app would be relying on the CORS allowlist alone against CSRF.
   *
   * Proxying makes the pair same-origin from the browser's point of view. Cookies
   * stay SameSite=Lax, CORS stops being involved at all, and the API's real
   * hostname is never exposed to the client.
   *
   * The cost is one extra network hop through Vercel, which is a fair price for
   * not weakening cookie policy.
   */
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_TARGET}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
