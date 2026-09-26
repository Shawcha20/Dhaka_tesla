import { NextResponse, type NextRequest } from 'next/server';

const ACCESS_COOKIE = 'dtp_access';

/** Sections that make no sense without a session. */
const PROTECTED = ['/passenger', '/driver', '/profile'];

/** Sections that make no sense with one. */
const AUTH_ONLY = ['/login', '/signup'];

/**
 * Coarse redirects, nothing more.
 *
 * This checks only that an access cookie is *present*. It deliberately does not
 * verify the signature: the JWT secret belongs on the API, and duplicating it into
 * the frontend's environment would widen the blast radius of a leak for no real
 * gain. Every actual authorization decision is the API's, and the API rejects a
 * forged or expired token regardless of what this middleware allowed through.
 *
 * The purpose is purely to avoid a signed-out user landing on a page that would
 * flash a skeleton and then bounce them to /login.
 *
 * Note this works only because the API is proxied through this app — the cookie is
 * same-origin, so middleware can see it at all.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(ACCESS_COOKIE);

  if (!hasSession && PROTECTED.some((prefix) => pathname.startsWith(prefix))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Remembered so the user lands where they were going after signing in.
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (hasSession && AUTH_ONLY.some((prefix) => pathname.startsWith(prefix))) {
    const url = request.nextUrl.clone();
    // Role is unknown here without decoding the token, so the root page decides.
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Excludes /api so proxied requests are never intercepted — a redirect on an API
   * call would turn a clean 401 into an HTML login page, which the client cannot
   * parse.
   */
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
