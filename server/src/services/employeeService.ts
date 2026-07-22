import db from '../db/index.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import type { Employee } from '../types/dinapoly-types.js';
import type { EmployeeRow } from '../types/db.js';

function rowToEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    name: row.name,
    pictureUrl: row.picture_url,
    isActive: row.is_active === 1,
  };
}

const insertEmployee = db.prepare<[string, string | null]>(
  'INSERT INTO employees (name, picture_url) VALUES (?, ?)'
);
const getEmployeeRow = db.prepare<[number], EmployeeRow>('SELECT * FROM employees WHERE id = ?');
const listActiveRows = db.prepare<[], EmployeeRow>('SELECT * FROM employees WHERE is_active = 1 ORDER BY name');
const listInactiveRows = db.prepare<[], EmployeeRow>('SELECT * FROM employees WHERE is_active = 0 ORDER BY name');
const setActive = db.prepare<[number, number]>('UPDATE employees SET is_active = ? WHERE id = ?');

export function addEmployee(name: unknown, pictureUrl: unknown): Employee {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ValidationError('name is required');
  }
  if (pictureUrl != null && typeof pictureUrl !== 'string') {
    throw new ValidationError('pictureUrl must be a string');
  }
  const { lastInsertRowid } = insertEmployee.run(name.trim(), pictureUrl ?? null);
  return rowToEmployee(getEmployeeRow.get(Number(lastInsertRowid))!);
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
