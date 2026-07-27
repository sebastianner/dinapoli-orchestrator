import { Router, type Response } from 'express';
import { login, refresh, logout, currentEmployee, ACCESS_TOKEN_TTL_SECONDS } from '../services/authService.js';
import { requireAuth, ACCESS_COOKIE, REFRESH_COOKIE } from '../middleware/auth.js';

const router = Router();

const isProd = process.env.NODE_ENV === 'production';

function setAuthCookies(res: Response, accessToken: string, refreshToken: string, refreshExpiresAt: Date): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
    path: '/',
  });
  // Scoped to /api/auth only - the refresh token is never needed outside
  // the refresh/logout calls, so it's never sent alongside ordinary API
  // requests.
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    expires: refreshExpiresAt,
    path: '/api/auth',
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

router.post('/login', async (req, res, next) => {
  try {
    const result = await login(req.body?.employeeId, req.body?.password);
    setAuthCookies(res, result.accessToken, result.refreshToken, result.refreshExpiresAt);
    res.json({ employee: result.employee });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', (req, res, next) => {
  try {
    const result = refresh(req.cookies?.[REFRESH_COOKIE]);
    setAuthCookies(res, result.accessToken, result.refreshToken, result.refreshExpiresAt);
    res.json({ employee: result.employee });
  } catch (err) {
    clearAuthCookies(res);
    next(err);
  }
});

router.post('/logout', (req, res) => {
  logout(req.cookies?.[REFRESH_COOKIE]);
  clearAuthCookies(res);
  res.json({ status: 'ok' });
});

router.get('/me', requireAuth, (req, res, next) => {
  try {
    res.json({ employee: currentEmployee(req.employeeId!) });
  } catch (err) {
    next(err);
  }
});

export default router;
