/* Audit suite 5: end-of-day accounting.
 *
 * Recomputes the day's books straight from the API's own order objects and
 * compares them against the closing report the server generated, then checks
 * the printed receipt's numbers against the same figures. Nothing here reuses
 * endOfDayService's SQL - the point is to catch a rollup that disagrees with
 * the orders it claims to summarize.
 */
import fs from 'node:fs';
import { Client, check, eq, section, summary, results } from './lib.js';

const client = new Client();
const OUT = process.env.AUDIT_OUT ?? '.';

function parseMoney(s: string): number {
  return Number(s.replace(/[^0-9-]/g, ''));
}

/**
 * Pulls "LABEL      $1.234.567" out of the printed receipt text. Only matches
 * lines that carry an amount - "Domicilio" appears twice on the receipt, once
 * as an order count under ORDENES POR TIPO and once as a money row under
 * VENTAS POR TIPO, and this is after the money one.
 */
function receiptValue(content: string, label: string): number | null {
  const line = content.split('\n').find((l) => l.trimStart().startsWith(label) && /\$[\d.,]+/.test(l));
  if (!line) return null;
  const m = line.match(/\$[\d.,]+/);
  return m ? parseMoney(m[0]) : null;
}

async function main() {
  await client.loginAdmin(1, 'audit1234');

  section('A0. Clearing the floor');
  // The earlier suites deliberately leave orders open (refused settlements,
  // validation probes). A real closing starts the same way: settle whatever is
  // still on the floor, then close. Each is paid at exactly its grand total.
  let cleared = 0;
  for (const status of ['PENDING', 'PRINTING', 'ACTIVE']) {
    for (const o of (await client.get(`/api/orders?status=${status}`)).body) {
      const live = (await client.get(`/api/orders/${o.id}`)).body;
      if (live.status !== 'ACTIVE') continue;
      const r = await client.post(`/api/orders/${live.id}/complete`, { payments: [{ method: 'cash', grossAmount: live.total }] });
      if (r.status === 200) cleared++;
    }
  }
  console.log(`  settled ${cleared} orders still open from earlier suites`);
  const stillOpen = (await client.get('/api/orders?status=ACTIVE')).body.length
    + (await client.get('/api/orders?status=PENDING')).body.length
    + (await client.get('/api/orders?status=PRINTING')).body.length;
  check('the floor is clear', stillOpen === 0, `${stillOpen} orders still open`);

  section('A. Independent recomputation of the day from the orders themselves');
  // Scoped to today's business day, not every COMPLETED order ever: the closing
  // report only covers today, and test-business-day.ts deliberately leaves
  // settled orders backdated to an earlier day behind.
  const todayDate = (await client.get('/api/cash-flow/current')).body.date;
  const all = (await client.get(`/api/orders?date=${todayDate}&status=COMPLETED`)).body;
  check('the day has completed orders to close', all.length > 0, `${all.length}`);

  const book = {
    orderCount: all.length,
    itemsSold: 0,
    customersServed: 0,
    totalSales: 0,
    deliverySales: 0,
    dineInTakeawaySales: 0,
    cashSales: 0,
    cardSales: 0,
    transferSales: 0,
    tips: 0,
    discounts: 0,
    deliveryFees: 0,
    deliveryOrderCount: 0,
    dineInOrderCount: 0,
    takeawayOrderCount: 0,
    grossCharged: 0,
    cashTips: 0,
  };
  const customerIds = new Set<number>();

  for (const o of all) {
    book.itemsSold += o.items.reduce((s: number, i: any) => s + i.quantity, 0);
    if (o.customerId != null) customerIds.add(o.customerId);
    if (o.orderType === 'delivery') book.deliveryOrderCount++;
    else if (o.orderType === 'dine_in') book.dineInOrderCount++;
    else book.takeawayOrderCount++;

    let orderSales = 0;
    for (const p of o.payments) {
      // Sales = what the business earned: the gross charge minus the tip (not
      // revenue) and minus the discount (never collected). Delivery fee stays in.
      const sales = p.grossAmount - p.tipAmount - p.discount;
      orderSales += sales;
      if (p.method === 'cash') { book.cashSales += sales; book.cashTips += p.tipAmount; }
      else if (p.method === 'card') book.cardSales += sales;
      else if (p.method === 'transfer') book.transferSales += sales;
      book.tips += p.tipAmount;
      book.discounts += p.discount;
      book.deliveryFees += p.deliveryFee;
      book.grossCharged += p.grossAmount;
    }
    book.totalSales += orderSales;
    if (o.orderType === 'delivery') book.deliverySales += orderSales;
    else book.dineInTakeawaySales += orderSales;
  }
  book.customersServed = customerIds.size;

  console.log(`  orders=${book.orderCount} items=${book.itemsSold} customers=${book.customersServed}`);
  console.log(`  sales=${book.totalSales.toLocaleString()} (cash ${book.cashSales.toLocaleString()} / card ${book.cardSales.toLocaleString()} / transfer ${book.transferSales.toLocaleString()})`);
  console.log(`  tips=${book.tips.toLocaleString()} discounts=${book.discounts.toLocaleString()} deliveryFees=${book.deliveryFees.toLocaleString()}`);

  check('payment-method buckets add up to total sales',
    book.cashSales + book.cardSales + book.transferSales === book.totalSales,
    `${book.cashSales + book.cardSales + book.transferSales} vs ${book.totalSales}`);
  check('order-type buckets add up to total sales',
    book.deliverySales + book.dineInTakeawaySales === book.totalSales);
  check('order-type counts add up to the order count',
    book.deliveryOrderCount + book.dineInOrderCount + book.takeawayOrderCount === book.orderCount);
  check('total charged = sales + tips + discounts',
    book.grossCharged === book.totalSales + book.tips + book.discounts,
    `${book.grossCharged} vs ${book.totalSales + book.tips + book.discounts}`);

  section('B. Closing the day');
  const cashFlowBefore = (await client.get('/api/cash-flow/current')).body;
  const close = await client.post('/api/end-of-day/close');
  check('close succeeds when every order is settled', close.status === 200, JSON.stringify(close.body).slice(0, 300));
  const report = close.body;

  eq('report orderCount', report.orderCount, book.orderCount);
  eq('report itemsSold', report.itemsSold, book.itemsSold);
  eq('report customersServed', report.customersServed, book.customersServed);
  eq('report totalSales', report.totalSales, book.totalSales);
  eq('report cashSales', report.cashSales, book.cashSales);
  eq('report cardSales', report.cardSales, book.cardSales);
  eq('report transferSales', report.transferSales, book.transferSales);
  eq('report deliverySales', report.deliverySales, book.deliverySales);
  eq('report dineInTakeawaySales', report.dineInTakeawaySales, book.dineInTakeawaySales);
  eq('report tips', report.tips, book.tips);
  eq('report discounts', report.discounts, book.discounts);
  eq('report deliveryOrderCount', report.deliveryOrderCount, book.deliveryOrderCount);
  eq('report dineInOrderCount', report.dineInOrderCount, book.dineInOrderCount);
  eq('report takeawayOrderCount', report.takeawayOrderCount, book.takeawayOrderCount);
  eq('report totalExpenses', report.totalExpenses, cashFlowBefore.expenses);
  eq('report cashInRegister snapshot', report.cashInRegister, cashFlowBefore.cashInRegister);

  section('C. The printed receipt agrees with the stored snapshot');
  const content: string = report.content;
  fs.writeFileSync(`${OUT}/closing-receipt.txt`, content);
  eq('receipt TOTAL VENTAS', receiptValue(content, 'TOTAL VENTAS'), report.totalSales);
  eq('receipt Ventas en efectivo', receiptValue(content, 'Ventas en efectivo'), report.cashSales);
  eq('receipt Ventas en tarjeta', receiptValue(content, 'Ventas en tarjeta'), report.cardSales);
  eq('receipt Ventas en transferencia', receiptValue(content, 'Ventas en transferencia'), report.transferSales);
  eq('receipt Propinas', receiptValue(content, 'Propinas'), report.tips);
  eq('receipt Descuentos', receiptValue(content, 'Descuentos'), report.discounts);
  eq('receipt Gastos del dia', receiptValue(content, 'Gastos del dia'), report.totalExpenses);
  eq('receipt Domicilio (sales by type)', receiptValue(content, 'Domicilio'), report.deliverySales);
  eq('receipt Mesa / Para llevar', receiptValue(content, 'Mesa / Para llevar'), report.dineInTakeawaySales);
  check('no receipt line overflows the 48-column paper',
    content.split('\n').every((l) => l.length <= 48),
    content.split('\n').filter((l) => l.length > 48).slice(0, 3).join(' || '));
  check('receipt is pure ASCII (no accents the printer would mangle)',
    // eslint-disable-next-line no-control-regex
    !/[^\x00-\x7F]/.test(content), (content.match(/[^\x00-\x7F]/g) ?? []).slice(0, 10).join(''));

  section('D. Does the drawer reconcile?');
  // Confirmed with the client: cash tips are pulled from the register and
  // handed to staff immediately, never left in the float overnight. So
  // "Efectivo final en caja" (base + cashSales, tips excluded) IS the whole
  // answer, not an approximation of it - there's no separate "plus tips" term
  // to reconcile. This run deliberately includes real cash tips (logged
  // below) so the assertion isn't vacuously true from having none.
  console.log(`  this run included ${book.cashTips.toLocaleString()} COP in cash tips, correctly excluded from the drawer figure`);
  const expectedDrawer = receiptValue(content, 'Efectivo final en caja');
  const printedFormula = cashFlowBefore.cashInRegister + report.cashSales;
  eq('"Efectivo final en caja" = base + cash sales, with no tip adjustment needed', expectedDrawer, printedFormula);

  section('E. Closing guards');
  const reports = await client.get('/api/end-of-day');
  check('past reports are listable', reports.status === 200 && reports.body.length >= 1, JSON.stringify(reports.status));
  const again = await client.post('/api/end-of-day/close');
  check('closing twice appends rather than failing', again.status === 200, JSON.stringify(again.body).slice(0, 200));
  const reports2 = (await client.get('/api/end-of-day')).body;
  eq('a second close created a second row', reports2.length, reports.body.length + 1);
  eq('the two closes agree on total sales', reports2[0].totalSales, reports2[1].totalSales);

  section('F. Analytics agrees with the closing report');
  const summaryRes = (await client.get('/api/analytics/summary?range=today')).body;
  eq('analytics totalSales matches the closing report', summaryRes.totalSales, report.totalSales);
  eq('analytics orderCount matches', summaryRes.orderCount, report.orderCount);
  eq('analytics itemsSold-per-order matches', Math.round(summaryRes.itemsPerOrder * 1000), Math.round((book.itemsSold / book.orderCount) * 1000));
  const breakdown = (await client.get('/api/analytics/breakdown?range=today')).body;
  eq('analytics cash bucket matches', breakdown.paymentMethods.find((m: any) => m.method === 'cash').sales, report.cashSales);
  eq('analytics card bucket matches', breakdown.paymentMethods.find((m: any) => m.method === 'card').sales, report.cardSales);
  eq('analytics transfer bucket matches', breakdown.paymentMethods.find((m: any) => m.method === 'transfer').sales, report.transferSales);
  const byType = breakdown.orderTypes;
  eq('analytics delivery sales matches', byType.find((t: any) => t.orderType === 'delivery').sales, report.deliverySales);
  eq('analytics dine_in + takeaway sales matches',
    byType.find((t: any) => t.orderType === 'dine_in').sales + byType.find((t: any) => t.orderType === 'takeaway').sales,
    report.dineInTakeawaySales);

  const products = (await client.get('/api/analytics/products?range=today')).body;
  const productRevenue = products.categories.reduce((s: number, c: any) => s + c.revenue, 0);
  // Item revenue is pre-discount and excludes delivery fees, so it should equal
  // sales + discounts - delivery fees.
  eq('product-revenue rollup reconciles with sales', productRevenue, book.totalSales + book.discounts - book.deliveryFees);

  section('G. Blocking a close while an order is open');
  const emp = (await client.get('/api/employees/active')).body[1];
  // Place one order directly over HTTP-free path: reuse an existing order by
  // reopening is not possible, so add a fresh one via the WS-less route below.
  const ws = await import('ws');
  const sock = new ws.WebSocket('ws://localhost:3999/ws/orders');
  await new Promise((r) => sock.on('open', r));
  const created: any = await new Promise((resolve) => {
    sock.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'order_created' || m.type === 'error') resolve(m);
    });
    sock.send(JSON.stringify({ orderType: 'dine_in', employeeId: emp.id, tableNumber: 1, items: [{ type: 'product', category: 'appetizers', product: 'garlic_bread', quantity: 1 }] }));
  });
  check('a new order was opened', created.type === 'order_created', JSON.stringify(created).slice(0, 200));
  const blocked = await client.post('/api/end-of-day/close');
  check('closing is blocked while an order is still open', blocked.status === 409, `${blocked.status} ${JSON.stringify(blocked.body)}`);
  check('and the error names the order so staff can find it',
    String(blocked.body?.error ?? '').includes(`#${created.order.id}`), JSON.stringify(blocked.body));
  sock.close();

  fs.writeFileSync(`${OUT}/day-book.json`, JSON.stringify({ book, report }, null, 1));
  summary();
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
