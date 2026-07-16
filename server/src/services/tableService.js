import db from '../db/index.js';

const setStatus = db.prepare('UPDATE restaurant_tables SET status = ? WHERE number = ?');
const countOpenOrdersForTable = db.prepare(
  `SELECT COUNT(*) AS c FROM orders WHERE table_number = ? AND status != 'COMPLETED'`
);

export function markTableBusy(tableNumber) {
  setStatus.run('busy', tableNumber);
}

/** Recomputes a table's free/busy status from its currently open orders. */
export function refreshTableStatus(tableNumber) {
  const { c } = countOpenOrdersForTable.get(tableNumber);
  setStatus.run(c > 0 ? 'busy' : 'free', tableNumber);
}

export function listTables() {
  return db.prepare('SELECT number, status FROM restaurant_tables ORDER BY number').all();
}
