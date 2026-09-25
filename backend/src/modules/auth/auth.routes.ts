import { Router } from 'express';

import {
  clearAuthCookies,
  REFRESH_COOKIE,
  setAuthCookies,
} from '../../lib/cookies.js';
import { requireAuth } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { loginSchema, registerSchema } from './auth.schema.js';
import {
  getMe,
  login,
  logout,
  refresh,
  register,
  type AuthResult,
} from './auth.service.js';

export const authRouter = Router();

/** The user shape returned to clients. Never includes the password hash. */
function publicUser(result: AuthResult) {
  return {
    id: result.user.id,
    name: result.user.name,
    email: result.user.email,
    phone: result.user.phone,
    role: result.user.role,
  };
}

/**
 * Passenger self-signup. `authLimiter` counts only failures, so a legitimate user
 * retrying a typo is not locked out while credential stuffing still is.
 */
authRouter.post('/register', authLimiter, async (req, res) => {
  const input = registerSchema.parse(req.body);
  const result = await register(input, req.get('user-agent'));

  setAuthCookies(res, result);
  res.status(201).json({ data: { user: publicUser(result) } });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const input = loginSchema.parse(req.body);
  const result = await login(input, req.get('user-agent'));

  setAuthCookies(res, result);
  res.json({ data: { user: publicUser(result) } });
});

/**
 * Rotates the session. Reads the refresh token from its cookie, or from the body
 * so a non-browser client can refresh without a cookie jar.
 */
authRouter.post('/refresh', authLimiter, async (req, res) => {
  const fromCookie = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  const fromBody =
    typeof req.body === 'object' && req.body !== null
      ? ((req.body as { refreshToken?: unknown }).refreshToken as string | undefined)
      : undefined;

  const result = await refresh(fromCookie ?? fromBody, req.get('user-agent'));

  setAuthCookies(res, result);
  res.json({ data: { user: publicUser(result) } });
});

/**
 * Always 204, even with no token or an unknown one. Logout that can fail is worse
 * than useless: it leaves the user believing they are still signed in.
 */
authRouter.post('/logout', async (req, res) => {
  await logout(req.cookies?.[REFRESH_COOKIE] as string | undefined);

  clearAuthCookies(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  // requireAuth guarantees req.user; the non-null assertion is the narrowest way
  // to express that without threading a second type through every handler.
  res.json({ data: await getMe(req.user!.id) });
});
