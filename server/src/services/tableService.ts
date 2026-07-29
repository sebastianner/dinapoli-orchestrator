import db from '../db/index.js';
import { ConflictError, ValidationError } from '../utils/errors.js';
import { broadcastTablesUpdate } from '../ws/broadcast.js';

const setStatus = db.prepare<[string, number]>('UPDATE restaurant_tables SET status = ? WHERE number = ?');
const countOpenOrdersForTable = db.prepare<[number], { c: number }>(
  `SELECT COUNT(*) AS c FROM orders WHERE table_number = ? AND status != 'COMPLETED'`
);

export function markTableBusy(tableNumber: number): void {
  setStatus.run('busy', tableNumber);
  broadcastTablesUpdate();
}

/** Recomputes a table's free/busy status from its currently open orders. */
export function refreshTableStatus(tableNumber: number): void {
  const { c } = countOpenOrdersForTable.get(tableNumber)!;
  setStatus.run(c > 0 ? 'busy' : 'free', tableNumber);
  broadcastTablesUpdate();
}

export interface RestaurantTableSummary {
  number: number;
  status: 'free' | 'busy';
}

export function listTables(): RestaurantTableSummary[] {
  return db.prepare<[], RestaurantTableSummary>('SELECT number, status FROM restaurant_tables ORDER BY number').all();
}

// ---------------------------------------------------------------------------
// Table count (admin - see Todo.MD "Edit table number", which turned out to
// mean the restaurant's total table count, not reassigning an order's table)
// ---------------------------------------------------------------------------

// No DB-level upper bound (restaurant_tables.number is just CHECK > 0, see
// schema.sql) since the count is meant to change at runtime - this is a
// sanity ceiling enforced here instead, purely to stop the admin panel from
// growing the floor plan into something nonsensical by mistake.
const MIN_TABLES = 1;
const MAX_TABLES = 40;

const getTableCountRow = db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM restaurant_tables');
const insertTable = db.prepare<[number]>("INSERT INTO restaurant_tables (number, status) VALUES (?, 'free')");
const deleteTableByNumber = db.prepare<[number]>('DELETE FROM restaurant_tables WHERE number = ?');

export function getTableCount(): number {
  return getTableCountRow.get()!.c;
}

/** Tables are always numbered 1..count with no gaps (see increase/decreaseTableCount), so existence is exactly "is this within the current count" - used by orderService instead of a hardcoded upper bound. */
export function tableExists(tableNumber: number): boolean {
  return Number.isInteger(tableNumber) && tableNumber >= 1 && tableNumber <= getTableCount();
}

/** Adds one more table (the next sequential number), free by default. Admin-only, see routes/tables.ts. */
export function increaseTableCount(): RestaurantTableSummary[] {
  const count = getTableCount();
  if (count >= MAX_TABLES) {
    throw new ValidationError(`el restaurante no puede tener más de ${MAX_TABLES} mesas`);
  }
  insertTable.run(count + 1);
  broadcastTablesUpdate();
  return listTables();
}

/** Removes the highest-numbered table - refuses if it's currently occupied, since that order still needs somewhere to be. Admin-only, see routes/tables.ts. */
export function decreaseTableCount(): RestaurantTableSummary[] {
  const count = getTableCount();
  if (count <= MIN_TABLES) {
    throw new ValidationError(`el restaurante necesita al menos ${MIN_TABLES} mesa`);
  }
  const { c: openOrders } = countOpenOrdersForTable.get(count)!;
  if (openOrders > 0) {
    throw new ConflictError(`la mesa ${count} tiene una orden abierta - complétala o reasígnala antes de eliminar esta mesa`);
  }
  deleteTableByNumber.run(count);
  broadcastTablesUpdate();
  return listTables();
}
