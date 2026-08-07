/* Audit suite 7: robustness and access control.
 *
 * Concurrency races on a single order, blackout recovery of the print queue,
 * and a full sweep of which endpoints are actually gated.
 */
import { Client, Terminal, check, eq, section, summary, results, warn, waitForStatus, sleep, pizza, product } from './lib.js';

const admin = new Client();
const staff = new Client();
const anon = new Client();
let term: Terminal;

async function place(req: any) {
  const r = await term.place(req);
  if (r.type !== 'order_created') throw new Error(`rejected: ${r.message}`);
  return waitForStatus(admin, r.order.id, 'ACTIVE');
}

async function main() {
  await admin.loginAdmin(1, 'audit1234');
  const employees = (await admin.get('/api/employees/active')).body;
  const staffEmp = employees.find((e: any) => e.role === 'staff');
  await staff.loginStaff(staffEmp.id);

  term = new Terminal('robust');
  await term.connect();
  const dineIn = (items: any[], extra: any = {}) => ({ orderType: 'dine_in', employeeId: staffEmp.id, tableNumber: 7, items, ...extra });

  // -------------------------------------------------------------------------
  section('A. Two cashiers settling the same order at the same moment');
  for (let round = 0; round < 5; round++) {
    const o = await place(dineIn([pizza('large', [{ flavor: 'margherita', portion: 100 }])])); // 66000
    const both = await Promise.all([
      admin.post(`/api/orders/${o.id}/complete`, { payments: [{ method: 'cash', grossAmount: 66000 }] }),
      staff.post(`/api/orders/${o.id}/complete`, { payments: [{ method: 'card', grossAmount: 66000 }] }),
    ]);
    const okCount = both.filter((r) => r.status === 200).length;
    const after = (await admin.get(`/api/orders/${o.id}`)).body;
    check(`round ${round + 1}: exactly one of two simultaneous settlements wins`, okCount === 1, `${okCount} succeeded`);
    check(`round ${round + 1}: exactly one payment row was written`, after.payments.length === 1,
      `${after.payments.length} rows: ${JSON.stringify(after.payments.map((p: any) => [p.method, p.grossAmount]))}`);
    check(`round ${round + 1}: the order was not double-charged`,
      after.payments.reduce((s: number, p: any) => s + p.grossAmount, 0) === after.grandTotal);
  }

  section('B. Adding items while the same order is being settled');
  let raceLost = 0;
  for (let round = 0; round < 5; round++) {
    const o = await place(dineIn([pizza('small', [{ flavor: 'margherita', portion: 100 }])])); // 34000
    const [addRes, payRes] = await Promise.all([
      admin.patch(`/api/orders/${o.id}/items`, { addItems: [product('drinks', 'soft_drink', { drinkFlavor: 'agua' })] }), // +5000
      staff.post(`/api/orders/${o.id}/complete`, { payments: [{ method: 'cash', grossAmount: 34000 }] }),
    ]);
    const after = (await admin.get(`/api/orders/${o.id}`)).body;
    const itemsSum = after.items.reduce((s: number, i: any) => s + i.unitPrice * i.quantity, 0);
    const paid = after.payments.reduce((s: number, p: any) => s + p.grossAmount, 0);
    // Whichever won, the books must still balance: items == total, and if it was
    // settled, what was charged must equal the order's grand total.
    check(`round ${round + 1}: items still sum to order.total`, itemsSum === after.total, `${itemsSum} vs ${after.total}`);
    if (after.status === 'COMPLETED' && paid !== after.grandTotal) {
      raceLost++;
      console.log(`    order ${o.id}: COMPLETED with ${paid} charged but grandTotal ${after.grandTotal} ` +
        `(add=${addRes.status}, pay=${payRes.status}) - an item was added to an order that was already paid`);
    }
  }
  check('no order ended up settled for less than it contains', raceLost === 0, `${raceLost} of 5 rounds`);

  section('C. Blackout recovery of the print queue');
  // Simulate a crash mid-print: an order left in PRINTING with unprinted items,
  // exactly the state queueService documents as its recovery case.
  const orphan = await place(dineIn([pizza('medium', [{ flavor: 'margherita', portion: 100 }])]));
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(`${process.env.DINAPOLI_DATA_DIR}/dinapoli.sqlite`);
  db.prepare("UPDATE orders SET status='PRINTING' WHERE id=?").run(orphan.id);
  db.prepare('UPDATE order_items SET printed_at=NULL WHERE order_id=?').run(orphan.id);
  db.close();
  const recovered = await waitForStatus(admin, orphan.id, 'ACTIVE', 20000).catch(() => null);
  check('an order stranded in PRINTING is picked back up and reprinted', recovered != null,
    'still not ACTIVE after 20s');
  if (recovered) {
    check('its items are stamped printed again', recovered.items.every((i: any) => i.printedAt != null));
    eq('recovery did not change the amount owed', recovered.total, orphan.total);
  }

  section('D. What is actually gated?');
  const target = await place(dineIn([product('appetizers', 'garlic_bread')]));
  type Case = { name: string; run: (c: Client) => Promise<{ status: number }> };
  const adminOnly: Case[] = [
    { name: 'DELETE /api/orders/:id', run: (c) => c.del(`/api/orders/${target.id}`) },
    { name: 'PUT /api/orders/:id/table', run: (c) => c.put(`/api/orders/${target.id}/table`, { tableNumber: 3 }) },
    { name: 'POST /api/employees', run: (c) => c.post('/api/employees', { name: 'Intruso' }) },
    { name: 'DELETE /api/employees/:id', run: (c) => c.del(`/api/employees/${staffEmp.id}`) },
    { name: 'PUT /api/employees/:id/role', run: (c) => c.put(`/api/employees/${staffEmp.id}/role`, { role: 'admin', password: 'hacked123' }) },
    { name: 'GET /api/products (admin menu)', run: (c) => c.get('/api/products') },
    { name: 'POST /api/products', run: (c) => c.post('/api/products', { categoryId: 'desserts', name: 'Gratis', price: 1 }) },
    { name: 'PUT /api/promos/:type', run: (c) => c.put('/api/promos/duo', { price: 1 }) },
    { name: 'GET /api/pizza-admin', run: (c) => c.get('/api/pizza-admin') },
    { name: 'POST /api/tables/increase', run: (c) => c.post('/api/tables/increase') },
    { name: 'POST /api/locations/cities', run: (c) => c.post('/api/locations/cities', { name: 'Nowhere' }) },
  ];
  for (const cse of adminOnly) {
    const asStaff = await cse.run(staff);
    const asAnon = await cse.run(anon);
    check(`${cse.name} rejects a staff session`, asStaff.status === 403 || asStaff.status === 401, `got ${asStaff.status}`);
    check(`${cse.name} rejects an anonymous caller`, asAnon.status === 401 || asAnon.status === 403, `got ${asAnon.status}`);
  }

  section('E. Money endpoints reachable with no session at all');
  const openMoney: Case[] = [
    { name: 'GET /api/orders (whole order book incl. payments)', run: (c) => c.get('/api/orders') },
    { name: 'GET /api/orders/:id', run: (c) => c.get(`/api/orders/${target.id}`) },
    { name: 'PATCH /api/orders/:id/items', run: (c) => c.patch(`/api/orders/${target.id}/items`, { addItems: [product('appetizers', 'garlic_bread')] }) },
    { name: 'POST /api/orders/:id/reprint', run: (c) => c.post(`/api/orders/${target.id}/reprint`, { kind: 'kitchen_ticket' }) },
    { name: 'GET /api/cash-flow/current', run: (c) => c.get('/api/cash-flow/current') },
    { name: 'POST /api/cash-flow/expenses', run: (c) => c.post('/api/cash-flow/expenses', { amount: 1000, justification: 'auditoria' }) },
    { name: 'PUT /api/cash-flow/current/amount', run: (c) => c.put('/api/cash-flow/current/amount', { amount: 123456 }) },
  ];
  const unguarded: string[] = [];
  for (const cse of openMoney) {
    const r = await cse.run(anon);
    if (r.status < 400) unguarded.push(cse.name);
  }
  // Settling and rewriting a settlement are the two that actually move money.
  const settleAnon = await anon.post(`/api/orders/${target.id}/complete`, { payments: [{ method: 'cash', grossAmount: (await anon.get(`/api/orders/${target.id}`)).body.grandTotal }] });
  if (settleAnon.status === 200) unguarded.push('POST /api/orders/:id/complete');
  const rewriteAnon = await anon.put(`/api/orders/${target.id}/payments`, { payments: [{ method: 'transfer', grossAmount: (await anon.get(`/api/orders/${target.id}`)).body.grandTotal, discount: 0 }] });
  if (rewriteAnon.status === 200) unguarded.push('PUT /api/orders/:id/payments');

  if (unguarded.length) {
    warn('endpoints that move or expose money accept an unauthenticated caller',
      `${unguarded.length} of ${openMoney.length + 2} reachable with no cookie at all: ${unguarded.join('; ')}`);
  } else {
    check('every money-moving endpoint requires a session', true);
  }

  section('F. Session handling');
  const me = await staff.get('/api/auth/me');
  // Note: the route wraps the employee ({ employee: {...} }), while the README
  // describes it as returning the employee itself.
  check('a staff session resolves to the right employee', me.status === 200 && me.body.employee?.id === staffEmp.id, JSON.stringify(me.body));
  const badAdmin = new Client();
  const wrongPw = await badAdmin.post('/api/auth/login', { employeeId: 1, password: 'wrong-password' });
  check('an admin login with the wrong password is refused', wrongPw.status === 401, `${wrongPw.status}`);
  const noPw = await badAdmin.post('/api/auth/login', { employeeId: 1 });
  check('an admin login with no password is refused', noPw.status === 401, `${noPw.status}`);
  const refreshed = await staff.post('/api/auth/refresh');
  check('a refresh token rotates successfully', refreshed.status === 200, JSON.stringify(refreshed.body).slice(0, 150));
  const stillMe = await staff.get('/api/auth/me');
  check('the rotated session still works', stillMe.status === 200);

  section('G. Malformed input handling');
  const junk = [
    ['POST /api/orders/:id/complete with a string body', await anon.post(`/api/orders/${target.id}/complete`, { payments: 'todo' })],
    ['PATCH /api/orders/:id/items with null', await anon.patch(`/api/orders/${target.id}/items`, { addItems: null })],
    ['GET /api/orders?date=garbage', await anon.get('/api/orders?date=nope')],
    ['GET /api/orders?pageSize=99999', await anon.get('/api/orders?pageSize=99999')],
    ['GET /api/orders/:id with a non-numeric id', await anon.get('/api/orders/abc')],
    ['GET /api/analytics/summary?range=custom without dates', await admin.get('/api/analytics/summary?range=custom')],
  ] as const;
  for (const [name, r] of junk) {
    check(`${name} returns a 4xx, not a crash`, r.status >= 400 && r.status < 500, `got ${r.status}: ${JSON.stringify(r.body).slice(0, 120)}`);
  }
  const health = await anon.get('/health');
  check('the server is still healthy after all of the above', health.status === 200);

  const socketJunk = new Terminal('junk');
  await socketJunk.connect();
  const junkReply = await socketJunk.place('not json at all' as unknown as object).catch(() => ({ type: 'timeout' }));
  check('the WebSocket rejects a non-JSON payload without dropping the connection', junkReply.type === 'error', JSON.stringify(junkReply));
  const afterJunk = await socketJunk.place({ orderType: 'dine_in', employeeId: staffEmp.id, tableNumber: 1, items: [product('appetizers', 'garlic_bread')] });
  check('the same socket still works afterwards', afterJunk.type === 'order_created', JSON.stringify(afterJunk).slice(0, 150));
  socketJunk.close();

  term.close();
  summary();
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
