import db from "../db/index.js";
import { getOrderById } from "./orderService.js";
import {
  printKitchenTicket,
  printKitchenTicketAddendum,
} from "./printerService.js";
import { broadcastOrderUpdate } from "../ws/broadcast.js";
import type { OrderStatus } from "../types/dinapoly-types.js";

const POLL_INTERVAL_MS = 2000;

// Orders sit in the `orders` table itself; its `status` column *is* the persistent
// queue. PENDING/PRINTING rows survive a crash or blackout because SQLite has
// already committed them, so recovery is just: on every tick (including the very
// first one at boot) re-scan for PENDING or PRINTING rows and (re)print them.
// A row stuck in PRINTING (process died mid-print) is retried exactly the same
// way a fresh PENDING row would be. An edit to an already-ACTIVE order (see
// orderService.editOrderItems) usually prints its own combined ticket
// synchronously without ever touching this queue - only when the order isn't
// ACTIVE yet, or that synchronous print fails, does it bounce back to
// PENDING, landing it back in this same scan.
const getPendingOrPrinting = db.prepare<
  [],
  { id: number; status: OrderStatus }
>(
  `SELECT id, status FROM orders WHERE status IN ('PENDING', 'PRINTING') ORDER BY id`,
);
const markPrinting = db.prepare<[number]>(
  `UPDATE orders SET status = 'PRINTING', print_attempts = print_attempts + 1 WHERE id = ?`,
);
const markActive = db.prepare<[number]>(
  `UPDATE orders SET status = 'ACTIVE' WHERE id = ?`,
);
const markPending = db.prepare<[number]>(
  `UPDATE orders SET status = 'PENDING' WHERE id = ?`,
);
// Stamped per item id rather than "every unprinted item on the order": printing
// is asynchronous now, so items can be added to this order *while its ticket is
// in flight (see the note in processOrder). A blanket UPDATE would mark those
// as printed even though they were never on the paper.
const markItemPrinted = db.prepare<[number]>(
  `UPDATE order_items SET printed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND printed_at IS NULL`,
);
const countUnprintedItems = db.prepare<[number], { count: number }>(
  `SELECT COUNT(*) AS count FROM order_items WHERE order_id = ? AND printed_at IS NULL`,
);
const markItemsPrinted = db.transaction((ids: number[]) => {
  for (const id of ids) markItemPrinted.run(id);
});

let isTicking = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function processOrder(id: number): Promise<void> {
  markPrinting.run(id);
  broadcastOrderUpdate(id);
  const order = getOrderById(id);
  const newItems = order.items.filter((item) => item.printedAt == null);
  // If some items already have printed_at set, the original kitchen ticket
  // already went out and this row is back here because an edit
  // (orderService.editOrderItems) bounced it to PENDING - the order wasn't
  // ACTIVE yet when the edit landed, or its own synchronous print failed -
  // print only the addition. Otherwise this is the order's first pass
  // through the queue: print the full ticket (every current item, since none
  // of them have printed yet).
  const isAddition = order.items.length > newItems.length;
  try {
    if (isAddition) {
      await printKitchenTicketAddendum(order, newItems);
    } else {
      await printKitchenTicket(order);
    }
    // Everything below is about the window that the `await` above opens up.
    // Printing no longer blocks the event loop (it used to, via execFileSync),
    // so staff can add items to this very order while its ticket is printing.
    // Only the items that were actually on the paper get stamped...
    markItemsPrinted(newItems.map((item) => item.id));
    // ...and if anything arrived meanwhile it's still unprinted, so the order
    // goes back to PENDING for an addendum rather than to ACTIVE, which the
    // queue would never look at again.
    if (countUnprintedItems.get(id)!.count > 0) {
      markPending.run(id);
    } else {
      markActive.run(id);
    }
    broadcastOrderUpdate(id);
  } catch (err) {
    // Leave status as PRINTING; the next tick (or the next boot, after a
    // blackout) will pick it up and try again.
    console.error(
      `[queue] failed to print order ${id}, will retry:`,
      (err as Error).message,
    );
  }
}

async function tick(): Promise<void> {
  if (isTicking) return;
  isTicking = true;
  try {
    // Re-scanned rather than iterating one snapshot: an order placed while an
    // earlier ticket is printing would otherwise wait for the next poll, which
    // it never used to (printing was synchronous, so a tick always finished
    // before the next order could be handled at all).
    //
    // `attempted` is what stops a permanently-failing printer from spinning
    // this loop: a row that fails stays PENDING/PRINTING but isn't retried
    // until the next poll, preserving the existing once-every-2s retry pace.
    const attempted = new Set<number>();
    for (;;) {
      const rows = getPendingOrPrinting.all().filter((row) => !attempted.has(row.id));
      if (rows.length === 0) break;
      for (const row of rows) {
        attempted.add(row.id);
        await processOrder(row.id);
      }
    }
  } finally {
    isTicking = false;
  }
}

export function startQueueWorker(): void {
  void tick(); // recovery pass: catches PRINTING rows left over from a crash/blackout
  intervalHandle = setInterval(() => void tick(), POLL_INTERVAL_MS);
  console.log(`[queue] worker started (poll interval ${POLL_INTERVAL_MS}ms)`);
}

export function stopQueueWorker(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

/**
 * Nudge the worker to process immediately instead of waiting for the next
 * poll tick - used both for a brand new order and for items added to an
 * existing one. A no-op while a tick is already running, which is fine: that
 * tick re-scans until the queue is empty before it finishes.
 */
export function notifyPrintQueue(): void {
  setImmediate(() => void tick());
}
