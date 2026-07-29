import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import db from '../db/index.js';
import { verifyPassword } from '../utils/password.js';
import { ValidationError } from '../utils/errors.js';
import type { Employee, EmployeeRole } from '../types/dinapoly-types.js';
import type { EmployeeRow, RefreshTokenRow } from '../types/db.js';

export class AuthError extends Error {
  statusCode = 401;

  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

// Falls back to a random secret so a missing .env doesn't crash the server -
// but every restart then invalidates all sessions, since nothing verifies
// against the old random value anymore. Set JWT_SECRET in server/.env for a
// stable one (see .env.example).
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('[auth] JWT_SECRET is not set - using an ephemeral secret for this process. Set JWT_SECRET in server/.env so sessions survive a restart.');
}
const SECRET: string = JWT_SECRET ?? crypto.randomBytes(48).toString('hex');

export const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24h, per spec
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AccessTokenPayload {
  employeeId: number;
  role: EmployeeRole;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
}

/** Throws if the token is missing, malformed, expired, or signed with a different secret. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, SECRET) as AccessTokenPayload;
}

function rowToEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    name: row.name,
    pictureUrl: row.picture_url,
    isActive: row.is_active === 1,
    role: row.role,
  };
}

const getEmployeeRow = db.prepare<[number], EmployeeRow>('SELECT * FROM employees WHERE id = ?');
const insertRefreshToken = db.prepare<[number, string, string]>(
  'INSERT INTO refresh_tokens (employee_id, token_hash, expires_at) VALUES (?, ?, ?)'
);
const getRefreshTokenByHash = db.prepare<[string], RefreshTokenRow>('SELECT * FROM refresh_tokens WHERE token_hash = ?');
const revokeRefreshTokenRow = db.prepare<[string]>(
  "UPDATE refresh_tokens SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE token_hash = ?"
);

/** Only the hash is ever persisted - same reasoning as password_hash, see utils/password.ts. */
function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function issueRefreshToken(employeeId: number): { token: string; expiresAt: Date } {
  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  insertRefreshToken.run(employeeId, hashToken(token), expiresAt.toISOString());
  return { token, expiresAt };
}

export interface SessionResult {
  employee: Employee;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

function issueSession(row: EmployeeRow): SessionResult {
  const accessToken = signAccessToken({ employeeId: row.id, role: row.role });
  const { token: refreshToken, expiresAt } = issueRefreshToken(row.id);
  return { employee: rowToEmployee(row), accessToken, refreshToken, refreshExpiresAt: expiresAt };
}

/**
 * 'admin' rows require a matching password; 'staff' rows log in by picking
 * their name, no password involved at all - the frontend never even shows a
 * password field for them.
 */
export async function login(employeeId: unknown, password: unknown): Promise<SessionResult> {
  if (typeof employeeId !== 'number' || !Number.isInteger(employeeId)) {
    throw new ValidationError('employeeId es obligatorio');
  }
  const row = getEmployeeRow.get(employeeId);
  if (!row || row.is_active !== 1) throw new AuthError('invalid employee');

  if (row.role === 'admin') {
    if (typeof password !== 'string' || password.length === 0) {
      throw new AuthError('password is required for admin accounts');
    }
    if (!row.password_hash || !(await verifyPassword(password, row.password_hash))) {
      throw new AuthError('invalid credentials');
    }
  }

  return issueSession(row);
}

/** Single-use: the presented token is revoked and a fresh one issued, whether or not it turns out valid to rotate against. */
export function refresh(refreshTokenRaw: string | undefined): SessionResult {
  if (!refreshTokenRaw) throw new AuthError('missing refresh token');
  const hash = hashToken(refreshTokenRaw);
  const row = getRefreshTokenByHash.get(hash);
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) {
    throw new AuthError('invalid refresh token');
  }
  revokeRefreshTokenRow.run(hash);

  const employeeRow = getEmployeeRow.get(row.employee_id);
  if (!employeeRow || employeeRow.is_active !== 1) throw new AuthError('invalid employee');

  return issueSession(employeeRow);
}

export function logout(refreshTokenRaw: string | undefined): void {
  if (!refreshTokenRaw) return;
  revokeRefreshTokenRow.run(hashToken(refreshTokenRaw));
}

export function currentEmployee(employeeId: number): Employee {
  const row = getEmployeeRow.get(employeeId);
  if (!row || row.is_active !== 1) throw new AuthError('invalid employee');
  return rowToEmployee(row);
}

/**
 * Re-checks the role against the DB rather than trusting the access token's
 * claim, so demoting an admin takes effect immediately instead of waiting up
 * to 24h for their existing token to expire.
 */
export function isCurrentlyAdmin(employeeId: number): boolean {
  const row = getEmployeeRow.get(employeeId);
  return row != null && row.is_active === 1 && row.role === 'admin';
}
