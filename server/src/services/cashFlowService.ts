import db from '../db/index.js';
import { ValidationError } from '../utils/errors.js';
import type { CashFlowDay, CashExpense } from '../types/dinapoly-types.js';
import type { CashRegisterSettingsRow, CashFlowRow, CashExpenseRow } from '../types/db.js';

function rowToCashFlowDay(row: CashFlowRow): CashFlowDay {
  return {
    id: row.id,
    date: row.date,
    cashInRegister: row.cash_in_register,
    expenses: row.expenses,
    createdAt: row.created_at,
  };
}

function rowToCashExpense(row: CashExpenseRow): CashExpense {
  return {
    id: row.id,
    cashFlowId: row.cash_flow_id,
    amount: row.amount,
    justification: row.justification,
    createdAt: row.created_at,
  };
}

function isNonNegativeInteger(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

// 'Today' is the restaurant's local business day (Bogota), not UTC - matters
// right around midnight UTC, which is still mid-evening in Colombia.
const bogotaDateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' });
function todayDateStr(): string {
  return bogotaDateFormat.format(new Date()); // en-CA formats as YYYY-MM-DD
}

// ---------------------------------------------------------------------------
// Settings (configurable default opening cash)
// ---------------------------------------------------------------------------

const getSettingsRow = db.prepare<[], CashRegisterSettingsRow>('SELECT * FROM cash_register_settings WHERE id = 1');
const setDefaultOpeningCash = db.prepare<[number]>('UPDATE cash_register_settings SET default_opening_cash = ? WHERE id = 1');

export interface CashRegisterSettings {
  defaultOpeningCash: number;
}

export function getSettings(): CashRegisterSettings {
  const row = getSettingsRow.get()!;
  return { defaultOpeningCash: row.default_opening_cash };
}

export function updateDefaultOpeningCash(amount: unknown): CashRegisterSettings {
  if (!isNonNegativeInteger(amount)) {
    throw new ValidationError('defaultOpeningCash must be a non-negative integer');
  }
  setDefaultOpeningCash.run(amount);
  return getSettings();
}

// ---------------------------------------------------------------------------
// Cash flow periods
// ---------------------------------------------------------------------------

const getLatestRow = db.prepare<[], CashFlowRow>('SELECT * FROM cash_flow ORDER BY id DESC LIMIT 1');
const insertCashFlow = db.prepare<[string, number]>('INSERT INTO cash_flow (date, cash_in_register) VALUES (?, ?)');
const getCashFlowById = db.prepare<[number], CashFlowRow>('SELECT * FROM cash_flow WHERE id = ?');
const listCashFlowRows = db.prepare<[], CashFlowRow>('SELECT * FROM cash_flow ORDER BY id DESC');
const setCurrentCash = db.prepare<[number, number]>('UPDATE cash_flow SET cash_in_register = ? WHERE id = ?');

/**
 * Returns today's register period, opening a fresh one from the configured
 * default the moment the latest row's date isn't today anymore (checked
 * here rather than on a timer, so it also runs once at server boot without
 * any extra wiring - see server.ts). No mid-day auto-reset: once today's row
 * exists, this just returns it as-is.
 */
export function getCurrentCashFlow(): CashFlowDay {
  const today = todayDateStr();
  const latest = getLatestRow.get();
  if (latest && latest.date === today) return rowToCashFlowDay(latest);

  const { defaultOpeningCash } = getSettings();
  const { lastInsertRowid } = insertCashFlow.run(today, defaultOpeningCash);
  return rowToCashFlowDay(getCashFlowById.get(Number(lastInsertRowid))!);
}

export function listCashFlowHistory(): CashFlowDay[] {
  return listCashFlowRows.all().map(rowToCashFlowDay);
}

export function updateCurrentCash(amount: unknown): CashFlowDay {
  if (!isNonNegativeInteger(amount)) {
    throw new ValidationError('amount must be a non-negative integer');
  }
  const current = getCurrentCashFlow();
  setCurrentCash.run(amount, current.id);
  return rowToCashFlowDay(getCashFlowById.get(current.id)!);
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

const insertExpense = db.prepare<[number, number, string]>(
  'INSERT INTO cash_expenses (cash_flow_id, amount, justification) VALUES (?, ?, ?)'
);
const getExpenseById = db.prepare<[number], CashExpenseRow>('SELECT * FROM cash_expenses WHERE id = ?');
const listExpensesByCashFlowId = db.prepare<[number], CashExpenseRow>(
  'SELECT * FROM cash_expenses WHERE cash_flow_id = ? ORDER BY id DESC'
);
const applyExpenseToCashFlow = db.prepare<[number, number, number]>(
  'UPDATE cash_flow SET cash_in_register = cash_in_register - ?, expenses = expenses + ? WHERE id = ?'
);

export function listExpensesForCashFlow(cashFlowId: number): CashExpense[] {
  return listExpensesByCashFlowId.all(cashFlowId).map(rowToCashExpense);
}

export interface AddExpenseResult {
  cashFlow: CashFlowDay;
  expense: CashExpense;
}

/** Records an expense against the current period, subtracting it from the available cash and adding it to the period's expense total. */
export function addExpense(amount: unknown, justification: unknown): AddExpenseResult {
  if (!isNonNegativeInteger(amount) || amount === 0) {
    throw new ValidationError('amount must be a positive integer');
  }
  if (typeof justification !== 'string' || justification.trim() === '') {
    throw new ValidationError('justification is required');
  }

  const result = db.transaction(() => {
    const current = getCurrentCashFlow();
    const { lastInsertRowid } = insertExpense.run(current.id, amount, justification.trim());
    applyExpenseToCashFlow.run(amount, amount, current.id);
    return {
      cashFlow: rowToCashFlowDay(getCashFlowById.get(current.id)!),
      expense: rowToCashExpense(getExpenseById.get(Number(lastInsertRowid))!),
    };
  })();

  return result;
}
