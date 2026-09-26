import { NextResponse, type NextRequest } from 'next/server';

/**
 * Runtime proxy to the API.
 *
 * This exists instead of a `rewrites()` entry in next.config.ts, and the reason is
 * worth recording: Next resolves rewrites when the config is *built*, and bakes the
 * destination into the standalone output. A container image built without
 * API_PROXY_TARGET set therefore ships a hardcoded localhost:4000 — which, inside the
 * web container, points at the web container. A route handler reads the environment
 * on every request, so one image works locally, in Compose, and on Vercel.
 *
 * The purpose is the same as before: requests stay same-origin from the browser's
 * point of view, so auth cookies keep SameSite=Lax, CORS is never involved, and the
 * API's real hostname is never exposed to the client.
 */
function target(): string {
  return process.env.API_PROXY_TARGET ?? 'http://localhost:4000';
}

/**
 * Hop-by-hop headers must not be forwarded: they describe this connection, not the
 * request. Passing `host` on would also break virtual hosting at the other end, and
 * forwarding `content-length` after the body has been re-read is a way to produce
 * silent truncation.
 */
const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'content-length',
  'accept-encoding',
]);

const STRIPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'content-encoding',
  'content-length',
]);

async function proxy(request: NextRequest, path: string[]): Promise<Response> {
  const url = `${target()}/api/${path.join('/')}${request.nextUrl.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });

  // Tells the API which client it is really serving, so its logs and rate limiting
  // see the browser rather than this server.
  const clientIp = request.headers.get('x-forwarded-for');
  if (clientIp) headers.set('x-forwarded-for', clientIp);

  const hasBody = !['GET', 'HEAD'].includes(request.method);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: request.method,
      headers,
      ...(hasBody ? { body: await request.arrayBuffer() } : {}),
      // Handled here rather than followed silently: a redirect from the API is
      // something the client should see, not something the proxy resolves.
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    // The API being unreachable is a gateway failure, and saying so in the app's own
    // error envelope means the client can parse it like any other error.
    return NextResponse.json(
      {
        error: {
          code: 'API_UNREACHABLE',
          message: 'Could not reach the API.',
          requestId: 'proxy',
        },
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) responseHeaders.set(key, value);
  });

  /**
   * Set here as well as by the API, deliberately.
   *
   * The browser talks to this proxy, not to the API, so this is the response that
   * actually reaches a cache. Relying on the upstream header alone means a single
   * misconfiguration two services away silently reintroduces caching of live
   * state — which already happened once: the driver's feed polls every few
   * seconds, and a cached copy left a driver seeing "nobody waiting" while
   * passengers were queued.
   */
  responseHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  responseHeaders.set('Pragma', 'no-cache');

  /**
   * Set-Cookie needs special handling: `Headers.set` collapses repeated values into
   * one comma-joined string, which browsers reject. The auth flow sends two cookies,
   * so getting this wrong would break sign-in in a way that looks like an API bug.
   */
  responseHeaders.delete('set-cookie');
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).path);
}

export async function POST(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).path);
}

export async function PATCH(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).path);
}

export async function PUT(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).path);
}

export async function DELETE(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).path);
}

/** Never cached: every one of these is either live state or a credential exchange. */
export const dynamic = 'force-dynamic';
