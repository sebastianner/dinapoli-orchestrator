import db from '../db/index.js';
import { getOrderById } from './orderService.js';
import { printKitchenTicket } from './printerService.js';

const POLL_INTERVAL_MS = 2000;

// Orders sit in the `orders` table itself; its `status` column *is* the persistent
// queue. PENDING/PRINTING rows survive a crash or blackout because SQLite has
// already committed them, so recovery is just: on every tick (including the very
// first one at boot) re-scan for PENDING or PRINTING rows and (re)print them.
// A row stuck in PRINTING (process died mid-print) is retried exactly the same
// way a fresh PENDING row would be.
const getPendingOrPrinting = db.prepare(
  `SELECT id, status FROM orders WHERE status IN ('PENDING', 'PRINTING') ORDER BY id`
);
const markPrinting = db.prepare(
  `UPDATE orders SET status = 'PRINTING', print_attempts = print_attempts + 1 WHERE id = ?`
);
const markActive = db.prepare(`UPDATE orders SET status = 'ACTIVE' WHERE id = ?`);

let isTicking = false;
let intervalHandle = null;

function processOrder(id) {
  markPrinting.run(id);
  const order = getOrderById(id);
  try {
    printKitchenTicket(order);
    markActive.run(id);
  } catch (err) {
    // Leave status as PRINTING; the next tick (or the next boot, after a
    // blackout) will pick it up and try again.
    console.error(`[queue] failed to print order ${id}, will retry:`, err.message);
  }
}

function tick() {
  if (isTicking) return;
  isTicking = true;
  try {
    const rows = getPendingOrPrinting.all();
    for (const row of rows) {
      processOrder(row.id);
    }
  } finally {
    isTicking = false;
  }
}

export function startQueueWorker() {
  tick(); // recovery pass: catches PRINTING rows left over from a crash/blackout
  intervalHandle = setInterval(tick, POLL_INTERVAL_MS);
  console.log(`[queue] worker started (poll interval ${POLL_INTERVAL_MS}ms)`);
}

export function stopQueueWorker() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

/** Nudge the worker to process immediately instead of waiting for the next poll tick. */
export function notifyNewOrder() {
  setImmediate(tick);
}
