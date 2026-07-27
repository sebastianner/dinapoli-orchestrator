import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken, isCurrentlyAdmin } from '../services/authService.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by requireAuth from a verified access_token cookie. */
    employeeId?: number;
  }
}

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';

/** Verifies the access_token cookie and attaches req.employeeId. 401s otherwise (expired, missing, malformed, or wrong secret). */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) {
    res.status(401).json({ error: 'not authenticated' });
    return;
  }
  try {
    req.employeeId = verifyAccessToken(token).employeeId;
    next();
  } catch {
    res.status(401).json({ error: 'session expired' });
  }
}

/** Must run after requireAuth. Checks the employee's CURRENT role in the DB, not the token's claim - see authService.isCurrentlyAdmin. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.employeeId == null || !isCurrentlyAdmin(req.employeeId)) {
    res.status(403).json({ error: 'admin access required' });
    return;
  }
  next();
}
