import { describe, expect, it } from 'vitest';

import { ACCESS_COOKIE, extractAccessToken } from '../../src/lib/cookies.js';

/** Minimal stand-in for the parts of Express's Request that the helper reads. */
function fakeRequest(options: {
  cookies?: Record<string, string | undefined>;
  headers?: Record<string, string>;
}) {
  const headers = options.headers ?? {};
  return {
    ...(options.cookies ? { cookies: options.cookies } : {}),
    get: (name: string) => headers[name.toLowerCase()],
  };
}

describe('extractAccessToken', () => {
  it('reads the httpOnly cookie', () => {
    const req = fakeRequest({ cookies: { [ACCESS_COOKIE]: 'cookie-token' } });

    expect(extractAccessToken(req)).toBe('cookie-token');
  });

  it('falls back to a bearer header, so curl and Postman work', () => {
    const req = fakeRequest({ headers: { authorization: 'Bearer header-token' } });

    expect(extractAccessToken(req)).toBe('header-token');
  });

  it('prefers the cookie when both are present', () => {
    // Browsers attach the cookie automatically; an explicit header is the
    // exception, so the cookie is the more trustworthy signal of intent.
    const req = fakeRequest({
      cookies: { [ACCESS_COOKIE]: 'cookie-token' },
      headers: { authorization: 'Bearer header-token' },
    });

    expect(extractAccessToken(req)).toBe('cookie-token');
  });

  it('accepts any capitalisation of the bearer scheme', () => {
    for (const scheme of ['Bearer', 'bearer', 'BEARER', 'BeArEr']) {
      const req = fakeRequest({ headers: { authorization: `${scheme} t` } });
      expect(extractAccessToken(req)).toBe('t');
    }
  });

  it('returns undefined when there is nothing to read', () => {
    expect(extractAccessToken(fakeRequest({}))).toBeUndefined();
    expect(extractAccessToken(fakeRequest({ cookies: {} }))).toBeUndefined();
  });

  it('ignores a non-bearer authorization scheme', () => {
    const req = fakeRequest({ headers: { authorization: 'Basic dXNlcjpwYXNz' } });

    expect(extractAccessToken(req)).toBeUndefined();
  });

  it('treats an empty bearer value as absent rather than as an empty token', () => {
    // Otherwise verifyAccessToken is handed '' and the failure surfaces as a
    // malformed-token error instead of a plain "not authenticated".
    expect(extractAccessToken(fakeRequest({ headers: { authorization: 'Bearer ' } }))).toBeUndefined();
    expect(extractAccessToken(fakeRequest({ headers: { authorization: 'Bearer' } }))).toBeUndefined();
  });

  it('trims whitespace around the token', () => {
    const req = fakeRequest({ headers: { authorization: 'Bearer   padded   ' } });

    expect(extractAccessToken(req)).toBe('padded');
  });
});
