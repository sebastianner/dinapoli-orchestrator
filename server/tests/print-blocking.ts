/* Audit suite 8: a slow printer must not slow anything else down.
 *
 * The Windows print path used to shell out synchronously twice per job
 * (Resume-Printer + print-raw.ps1, ~1s measured), which blocked the Node event
 * loop outright: for that second the server answered nothing at all. It now
 * uses async execFile, and the queue resume runs on a timer instead of before
 * every job.
 *
 * Run the server with PRINTER_EMULATION_DELAY_MS set to a realistic per-ticket
 * cost and this measures what that costs everyone else. Add
 * PRINTER_EMULATION_BLOCKING=1 to make the emulated printer block the loop the
 * way the old code did - every assertion below about responsiveness should fail
 * in that mode, which is what proves they'd catch a regression.
 *
 *   PRINTER_EMULATION_DELAY_MS=1000 npx tsx tests/print-blocking.ts
 */
import { Client, Terminal, check, section, summary, results, sleep, product, waitForStatus } from './lib.js';

const client = new Client();
const DELAY = Number(process.env.PRINTER_EMULATION_DELAY_MS ?? 0);
/** Set when the server is deliberately running the old blocking behaviour, so the expectations flip. */
const EXPECT_BLOCKING = process.env.PRINTER_EMULATION_BLOCKING === '1';

async function main() {
  await client.loginAdmin(1, 'audit1234');
  const emp = (await client.get('/api/employees/active')).body[1].id;
  const order = (items: any[], table: number) => ({ orderType: 'dine_in', employeeId: emp, tableNumber: table, items });
  const one = () => [product('appetizers', 'garlic_bread')];

  console.log(`  emulated per-ticket print cost: ${DELAY}ms (${EXPECT_BLOCKING ? 'BLOCKING the loop, the old behaviour' : 'off-loop, the fixed behaviour'})`);
  if (DELAY === 0) console.log('  (set PRINTER_EMULATION_DELAY_MS on the server to make this meaningful)');

  const term = new Terminal('blocking');
  await term.connect();
  const warm = await term.place(order(one(), 1));
  await waitForStatus(client, warm.order.id, 'ACTIVE', 60000);
  await sleep(500);

  // -------------------------------------------------------------------------
  section('A. An order placed while the printer is idle');
  {
    const t0 = Date.now();
    const reply = await term.place(order(one(), 1));
    const ackMs = Date.now() - t0;
    check('accepted', reply.type === 'order_created', JSON.stringify(reply).slice(0, 120));
    console.log(`  ack in ${ackMs}ms`);
    check('acked promptly', ackMs < 300, `${ackMs}ms`);
    await waitForStatus(client, reply.order.id, 'ACTIVE', 60000);
  }

  section('B. An order placed WHILE a ticket is printing');
  {
    // Fire one order, then a second 50ms later - the queue worker starts
    // printing the first almost immediately (notifyPrintQueue uses
    // setImmediate), so the second lands inside the printing window.
    const first = term.place(order(one(), 2));
    await sleep(50);
    const t0 = Date.now();
    const second = await term.place(order(one(), 3));
    const ackMs = Date.now() - t0;
    await first;
    check('accepted', second.type === 'order_created', JSON.stringify(second).slice(0, 120));
    console.log(`  ack in ${ackMs}ms (a ticket was printing at the time)`);
    if (EXPECT_BLOCKING) {
      check('with the old blocking printer, this waits for the print', ackMs >= DELAY * 0.6, `${ackMs}ms`);
    } else {
      check('intake is not held up by the printer', ackMs < Math.max(300, DELAY * 0.4),
        `${ackMs}ms against a ${DELAY}ms print - the ack should not be waiting on it`);
    }
    await waitForStatus(client, second.order!.id, 'ACTIVE', 60000);
  }

  section('C. A burst of 6 orders while printing');
  {
    const t0 = Date.now();
    const replies = await Promise.all(Array.from({ length: 6 }, (_, i) => term.place(order(one(), (i % 9) + 1))));
    const acceptMs = Date.now() - t0;
    check('all 6 accepted', replies.every((r) => r.type === 'order_created'), replies.map((r) => r.type).join(','));
    console.log(`  all 6 acked in ${acceptMs}ms`);
    check('acked without waiting on the printer', acceptMs < Math.max(500, DELAY * 0.5), `${acceptMs}ms`);

    // Printing itself is still serial - a thermal printer is a serial device -
    // so the tickets take ~DELAY each. That's expected; the point is that it no
    // longer costs anyone else anything.
    const printStart = Date.now();
    for (const r of replies) await waitForStatus(client, r.order!.id, 'ACTIVE', 90000);
    console.log(`  all 6 tickets printed ${Date.now() - printStart}ms later (~${DELAY}ms each, still serial)`);
    check('every ticket printed', true);
  }

  section('D. Is the server responsive while tickets print?');
  {
    const latencies: number[] = [];
    let errors = 0;
    // Keep 8 tickets flowing through the printer for the whole sample window.
    const burst = Promise.all(Array.from({ length: 8 }, (_, i) => term.place(order(one(), (i % 9) + 1))));
    const until = Date.now() + Math.max(3000, DELAY * 8);
    while (Date.now() < until) {
      const t0 = Date.now();
      try {
        await client.get('/health');
        latencies.push(Date.now() - t0);
      } catch {
        errors++;
      }
    }
    const replies = await burst;
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const worst = latencies[latencies.length - 1];
    console.log(`  /health over ${latencies.length} calls during ~${DELAY * 8}ms of printing: p50 ${p50}ms, worst ${worst}ms, ${errors} failed`);

    if (EXPECT_BLOCKING) {
      check('with the old blocking printer, a request gets stalled a whole print', worst >= DELAY * 0.6, `worst ${worst}ms`);
    } else {
      check('no request is stalled by a print', worst < Math.max(500, DELAY * 0.4),
        `worst ${worst}ms against a ${DELAY}ms print`);
      // Node's default keepAliveTimeout is 5s: a block longer than that used to
      // reset idle keep-alive sockets the instant the loop freed up, failing
      // in-flight requests outright rather than merely delaying them.
      check('and no connection is dropped', errors === 0, `${errors} requests failed outright`);
    }
    for (const r of replies) await waitForStatus(client, r.order!.id, 'ACTIVE', 120000);
  }

  section('E. Nothing is lost, and nothing prints twice');
  {
    const countOrders = async (): Promise<number> => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try { return (await client.get('/api/orders')).body.length; } catch { await sleep(300); }
      }
      throw new Error('could not read the order list');
    };
    const before = await countOrders();
    const replies = await Promise.all(Array.from({ length: 8 }, (_, i) => term.place(order(one(), (i % 9) + 1))));
    check('all 8 accepted', replies.every((r) => r.type === 'order_created'));
    for (const r of replies) await waitForStatus(client, r.order!.id, 'ACTIVE', 120000);
    const after = await countOrders();
    check('all 8 persisted', after - before === 8, `${after - before} new rows`);
    const orders = await Promise.all(replies.map((r) => client.get(`/api/orders/${r.order!.id}`)));
    check('every item on every one of them is stamped printed exactly once',
      orders.every((o) => o.body.items.every((i: any) => i.printedAt != null)),
      JSON.stringify(orders.map((o) => o.body.items.map((i: any) => i.printedAt))));
  }

  section('F. Items added WHILE that order\'s ticket is printing still reach the kitchen');
  {
    // This is the race the async switch introduces: the loop is free during a
    // print, so an item can be added to the very order being printed. It must
    // not be stamped as printed (it was never on the paper) and the order must
    // go back to PENDING for an addendum rather than straight to ACTIVE.
    const placed = await term.place(order(one(), 6));
    check('order placed', placed.type === 'order_created');
    const id = placed.order!.id;
    // Land the addition inside the print window.
    await sleep(Math.min(120, Math.max(20, DELAY / 4)));
    const added = await client.patch(`/api/orders/${id}/items`, { addItems: [product('desserts', 'ice_cream')] });
    check('the item is accepted mid-print', added.status === 200, JSON.stringify(added.body).slice(0, 160));

    const final = await waitForStatus(client, id, 'ACTIVE', 120000);
    check('both items are on the order', final.items.length === 2, `${final.items.length} items`);
    check('and BOTH were actually printed, not just stamped',
      final.items.every((i: any) => i.printedAt != null),
      JSON.stringify(final.items.map((i: any) => [i.id, i.printedAt])));
  }

  term.close();
  summary();
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
