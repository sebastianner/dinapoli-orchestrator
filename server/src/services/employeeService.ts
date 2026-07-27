import db from '../db/index.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import { hashPassword } from '../utils/password.js';
import type { Employee, EmployeeRole } from '../types/dinapoly-types.js';
import type { EmployeeRow } from '../types/db.js';

const MIN_PASSWORD_LENGTH = 6;

function rowToEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    name: row.name,
    pictureUrl: row.picture_url,
    isActive: row.is_active === 1,
    role: row.role,
  };
}

const insertEmployee = db.prepare<[string, string | null, string, string | null]>(
  'INSERT INTO employees (name, picture_url, role, password_hash) VALUES (?, ?, ?, ?)'
);
const getEmployeeRow = db.prepare<[number], EmployeeRow>('SELECT * FROM employees WHERE id = ?');
const listActiveRows = db.prepare<[], EmployeeRow>('SELECT * FROM employees WHERE is_active = 1 ORDER BY name');
const listInactiveRows = db.prepare<[], EmployeeRow>('SELECT * FROM employees WHERE is_active = 0 ORDER BY name');
const setActive = db.prepare<[number, number]>('UPDATE employees SET is_active = ? WHERE id = ?');
const setRole = db.prepare<[string, string | null, number]>('UPDATE employees SET role = ?, password_hash = ? WHERE id = ?');

function resolveRole(role: unknown): EmployeeRole {
  if (role == null) return 'staff';
  if (role !== 'staff' && role !== 'admin') {
    throw new ValidationError("role must be 'staff' or 'admin'");
  }
  return role;
}

/**
 * Only 'admin' rows ever carry a password_hash - enforced here, not just in
 * the UI. Promoting to admin (or creating one) requires a password;
 * demoting to staff always drops it, since staff never authenticate with
 * one. `existingHash` lets a same-role call (e.g. an admin editing their own
 * password, or a plain metadata update) keep the current hash when no new
 * password is supplied, instead of forcing one on every call.
 */
async function resolvePasswordHash(role: EmployeeRole, password: unknown, existingHash: string | null): Promise<string | null> {
  if (role === 'staff') {
    if (password != null) throw new ValidationError('only admins can have a password');
    return null;
  }
  if (password == null) {
    if (existingHash) return existingHash;
    throw new ValidationError(`admin accounts require a password (min ${MIN_PASSWORD_LENGTH} characters)`);
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return hashPassword(password);
}

export async function addEmployee(name: unknown, pictureUrl: unknown, role?: unknown, password?: unknown): Promise<Employee> {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ValidationError('name is required');
  }
  if (pictureUrl != null && typeof pictureUrl !== 'string') {
    throw new ValidationError('pictureUrl must be a string');
  }
  const resolvedRole = resolveRole(role);
  const passwordHash = await resolvePasswordHash(resolvedRole, password, null);
  const { lastInsertRowid } = insertEmployee.run(name.trim(), pictureUrl ?? null, resolvedRole, passwordHash);
  return rowToEmployee(getEmployeeRow.get(Number(lastInsertRowid))!);
}

/** Promotes/demotes an employee. Promoting to admin (or rotating an existing admin's password) requires `password`; demoting to staff clears any stored hash. */
export async function setEmployeeRole(id: number, role: unknown, password?: unknown): Promise<Employee> {
  const row = getEmployeeRow.get(id);
  if (!row) throw new NotFoundError(`employee ${id} not found`);
  const resolvedRole = resolveRole(role);
  const existingHash = resolvedRole === row.role ? row.password_hash : null;
  const passwordHash = await resolvePasswordHash(resolvedRole, password, existingHash);
  setRole.run(resolvedRole, passwordHash, id);
  return rowToEmployee(getEmployeeRow.get(id)!);
}

export function getEmployeeById(id: number): Employee {
  const row = getEmployeeRow.get(id);
  if (!row) throw new NotFoundError(`employee ${id} not found`);
  return rowToEmployee(row);
}

export function listActiveEmployees(): Employee[] {
  return listActiveRows.all().map(rowToEmployee);
}

export function listInactiveEmployees(): Employee[] {
  return listInactiveRows.all().map(rowToEmployee);
}

/** Soft delete: marks the employee inactive rather than removing the row, so past orders keep a valid employeeId. */
export function deactivateEmployee(id: number): Employee {
  getEmployeeById(id); // 404s if the employee doesn't exist
  setActive.run(0, id);
  return getEmployeeById(id);
}

/** Reverses deactivateEmployee, making the employee selectable for new orders again. */
export function activateEmployee(id: number): Employee {
  getEmployeeById(id); // 404s if the employee doesn't exist
  setActive.run(1, id);
  return getEmployeeById(id);
}
