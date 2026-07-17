import db from '../db/index.js';

const setStatus = db.prepare<[string, number]>('UPDATE restaurant_tables SET status = ? WHERE number = ?');
const countOpenOrdersForTable = db.prepare<[number], { c: number }>(
  `SELECT COUNT(*) AS c FROM orders WHERE table_number = ? AND status != 'COMPLETED'`
);

export function markTableBusy(tableNumber: number): void {
  setStatus.run('busy', tableNumber);
}

/** Recomputes a table's free/busy status from its currently open orders. */
export function refreshTableStatus(tableNumber: number): void {
  const { c } = countOpenOrdersForTable.get(tableNumber)!;
  setStatus.run(c > 0 ? 'busy' : 'free', tableNumber);
}

export interface RestaurantTableSummary {
  number: number;
  status: 'free' | 'busy';
}

export function listTables(): RestaurantTableSummary[] {
  return db.prepare<[], RestaurantTableSummary>('SELECT number, status FROM restaurant_tables ORDER BY number').all();
}
