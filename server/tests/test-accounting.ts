/* Audit suite 5: end-of-day accounting.
 *
 * Recomputes the day's books straight from the API's own order objects and
 * compares them against the closing report the server generated, then checks
 * the printed receipt's numbers against the same figures. Nothing here reuses
 * endOfDayService's SQL - the point is to catch a rollup that disagrees with
 * the orders it claims to summarize.
 */
import fs from 'node:fs';
import { Client, Terminal, check, eq, section, summary, results, waitForStatus, sleep, pizza, product } from './lib.js';

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
    rappiSales: 0,
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
      // Sales = what the business earned: the gross charge minus the discount
      // (never collected). Cash tips are handed straight to staff and never
      // touch the register, so they're stripped out same as before; tips paid
      // by card/transfer/rappi pass through the register/bank, so they stay
      // IN as income. Delivery fee always stays in.
      const sales = p.method === 'cash' ? p.grossAmount - p.tipAmount - p.discount : p.grossAmount - p.discount;
      orderSales += sales;
      if (p.method === 'cash') { book.cashSales += sales; book.cashTips += p.tipAmount; }
      else if (p.method === 'card') book.cardSales += sales;
      else if (p.method === 'transfer') book.transferSales += sales;
      else if (p.method === 'rappi') book.rappiSales += sales;
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
  console.log(`  sales=${book.totalSales.toLocaleString()} (cash ${book.cashSales.toLocaleString()} / card ${book.cardSales.toLocaleString()} / transfer ${book.transferSales.toLocaleString()} / rappi ${book.rappiSales.toLocaleString()})`);
  console.log(`  tips=${book.tips.toLocaleString()} discounts=${book.discounts.toLocaleString()} deliveryFees=${book.deliveryFees.toLocaleString()}`);

  check('payment-method buckets add up to total sales',
    book.cashSales + book.cardSales + book.transferSales + book.rappiSales === book.totalSales,
    `${book.cashSales + book.cardSales + book.transferSales + book.rappiSales} vs ${book.totalSales}`);
  check('order-type buckets add up to total sales',
    book.deliverySales + book.dineInTakeawaySales === book.totalSales);
  check('order-type counts add up to the order count',
    book.deliveryOrderCount + book.dineInOrderCount + book.takeawayOrderCount === book.orderCount);
  // Only cash tips sit outside totalSales now - card/transfer/rappi tips are
  // already folded into their method's sales figure (see the per-payment
  // formula above), so they're not added again here.
  check('total charged = sales + cash tips + discounts',
    book.grossCharged === book.totalSales + book.cashTips + book.discounts,
    `${book.grossCharged} vs ${book.totalSales + book.cashTips + book.discounts}`);

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
  eq('report rappiSales', report.rappiSales, book.rappiSales);
  eq('report deliverySales', report.deliverySales, book.deliverySales);
  eq('report dineInTakeawaySales', report.dineInTakeawaySales, book.dineInTakeawaySales);
  eq('report tips', report.tips, book.tips);
  eq('report discounts', report.discounts, book.discounts);
  eq('report deliveryOrderCount', report.deliveryOrderCount, book.deliveryOrderCount);
  eq('report dineInOrderCount', report.dineInOrderCount, book.dineInOrderCount);
  eq('report takeawayOrderCount', report.takeawayOrderCount, book.takeawayOrderCount);
  eq('report totalExpenses', report.totalExpenses, cashFlowBefore.expenses);
  eq('report cashInRegister snapshot', report.cashInRegister, cashFlowBefore.cashInRegister);

  const liveExpenses = (await client.get(`/api/cash-flow/${cashFlowBefore.id}/expenses`)).body;
  eq('report expensesDetail count matches the live cash_expenses rows', report.expensesDetail.length, liveExpenses.length);
  eq('report expensesDetail sums to totalExpenses',
    report.expensesDetail.reduce((s: number, e: any) => s + e.amount, 0), report.totalExpenses);
  check('every live expense is itemized on the report with its justification',
    liveExpenses.every((le: any) => report.expensesDetail.some((rd: any) => rd.amount === le.amount && rd.justification === le.justification)),
    JSON.stringify({ liveExpenses, expensesDetail: report.expensesDetail }).slice(0, 400));

  section('C. The printed receipt agrees with the stored snapshot');
  const content: string = report.content;
  fs.writeFileSync(`${OUT}/closing-receipt.txt`, content);
  eq('receipt TOTAL VENTAS', receiptValue(content, 'TOTAL VENTAS'), report.totalSales);
  eq('receipt Ventas en efectivo', receiptValue(content, 'Ventas en efectivo'), report.cashSales);
  eq('receipt Ventas en tarjeta', receiptValue(content, 'Ventas en tarjeta'), report.cardSales);
  eq('receipt Ventas en transferencia', receiptValue(content, 'Ventas en transferencia'), report.transferSales);
  eq('receipt Ventas en Rappi', receiptValue(content, 'Ventas en Rappi'), report.rappiSales);
  eq('receipt Propinas', receiptValue(content, 'Propinas'), report.tips);
  eq('receipt Descuentos', receiptValue(content, 'Descuentos'), report.discounts);
  eq('receipt Total gastos', receiptValue(content, 'Total gastos'), report.totalExpenses);
  for (const expense of report.expensesDetail as { justification: string; amount: number }[]) {
    check(`receipt itemizes expense "${expense.justification}"`,
      receiptValue(content, expense.justification) === expense.amount,
      `expected ${expense.amount}, got ${receiptValue(content, expense.justification)}`);
  }
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
  // cashSales (tips already excluded) IS the whole cash-income answer. The
  // printed "Efectivo final en caja" deliberately excludes the base de caja
  // (cashInRegister) - it reads as "cash income and passives for the day",
  // not "what should physically be in the drawer" (that's the live Caja
  // page's job). This run deliberately includes real cash tips (logged
  // below) so the exclusion assertion isn't vacuously true from having none.
  console.log(`  this run included ${book.cashTips.toLocaleString()} COP in cash tips, correctly excluded from the drawer figure`);
  const expectedDrawer = receiptValue(content, 'Efectivo final en caja');
  const printedFormula = report.cashSales - report.totalExpenses;
  eq('"Efectivo final en caja" = cash sales - expenses, base de caja excluded', expectedDrawer, printedFormula);

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
  eq('analytics rappi bucket matches', breakdown.paymentMethods.find((m: any) => m.method === 'rappi').sales, report.rappiSales);
  const byType = breakdown.orderTypes;
  eq('analytics delivery sales matches', byType.find((t: any) => t.orderType === 'delivery').sales, report.deliverySales);
  eq('analytics dine_in + takeaway sales matches',
    byType.find((t: any) => t.orderType === 'dine_in').sales + byType.find((t: any) => t.orderType === 'takeaway').sales,
    report.dineInTakeawaySales);

  const products = (await client.get('/api/analytics/products?range=today')).body;
  const productRevenue = products.categories.reduce((s: number, c: any) => s + c.revenue, 0);
  // Item revenue is pre-discount and excludes delivery fees AND non-cash tips
  // (both of which are folded into totalSales now - see aggregateSales), so
  // it should equal sales + discounts - delivery fees - non-cash tips.
  const nonCashTips = book.tips - book.cashTips;
  eq('product-revenue rollup reconciles with sales', productRevenue, book.totalSales + book.discounts - book.deliveryFees - nonCashTips);

  section('F2. Flavor analytics (regression coverage for the "Pizza mitad y mitad" fix)');
  {
    const findFlavor = (list: any[], name: string) => list.find((f: any) => f.flavor === name)?.quantity ?? 0;
    const snapshot = async () => ({
      all: (await client.get('/api/analytics/flavors?range=today')).body.flavors,
      pizzas: (await client.get('/api/analytics/flavors?range=today&category=pizzas')).body.flavors,
      gratinados: (await client.get('/api/analytics/flavors?range=today&category=gratinados')).body.flavors,
      calzones: (await client.get('/api/analytics/flavors?range=today&category=calzones')).body.flavors,
    });

    // "today" already carries flavor activity from every earlier suite in this
    // run, so this asserts on the DELTA this section itself adds, not on an
    // absolute total - the only way to make the check exact against a shared,
    // cumulative business day rather than an isolated dataset.
    const before = await snapshot();

    const term2 = new Terminal('flavor-audit');
    await term2.connect();
    const emp2 = (await client.get('/api/employees/active')).body[0].id;
    const dineIn2 = (items: any[]) => ({ orderType: 'dine_in', employeeId: emp2, tableNumber: 6, items });

    const placeAndSettle = async (items: any[]) => {
      const r = await term2.place(dineIn2(items));
      if (r.type !== 'order_created') throw new Error(`rejected: ${r.message}`);
      const active = await waitForStatus(client, r.order!.id, 'ACTIVE');
      const paid = await client.post(`/api/orders/${active.id}/complete`, { payments: [{ method: 'cash', grossAmount: active.total }] });
      if (paid.status !== 200) throw new Error(`settle failed: ${JSON.stringify(paid.body)}`);
      return paid.body;
    };

    // A whole-Margarita pizza, a 50/50 Margarita/Pepperoni split, a Pepperoni
    // gratinado, and a Margarita calzone - four different flavor shapes (see
    // analyticsService.getFlavors' doc comment) feeding known, hand-computable
    // deltas.
    await placeAndSettle([pizza('small', [{ flavor: 'margherita', portion: 100 }])]);
    await placeAndSettle([pizza('medium', [{ flavor: 'margherita', portion: 50 }, { flavor: 'pepperoni', portion: 50 }])]);
    await placeAndSettle([product('gratinados', 'gratin', { pizzaFlavor: 'pepperoni' })]);
    await placeAndSettle([product('calzones', 'calzone', { size: 'small', pizzaFlavor: 'margherita' })]);
    term2.close();
    await sleep(200);

    const after = await snapshot();
    const approxEq = (name: string, actual: number, expected: number) =>
      check(name, Math.abs(actual - expected) < 0.01, `expected delta ~${expected}, got ${actual}`);

    approxEq('global Margarita quantity grew by 2.5 (1 whole pizza + 0.5 split + 1 calzone)',
      findFlavor(after.all, 'Margarita') - findFlavor(before.all, 'Margarita'), 2.5);
    approxEq('global Pepperoni quantity grew by 1.5 (0.5 split + 1 gratinado)',
      findFlavor(after.all, 'Pepperoni') - findFlavor(before.all, 'Pepperoni'), 1.5);

    approxEq('pizzas-only Margarita quantity grew by 1.5 (1 + 0.5)',
      findFlavor(after.pizzas, 'Margarita') - findFlavor(before.pizzas, 'Margarita'), 1.5);
    approxEq('pizzas-only Pepperoni quantity grew by 0.5',
      findFlavor(after.pizzas, 'Pepperoni') - findFlavor(before.pizzas, 'Pepperoni'), 0.5);

    approxEq('gratinados-only Pepperoni quantity grew by 1',
      findFlavor(after.gratinados, 'Pepperoni') - findFlavor(before.gratinados, 'Pepperoni'), 1);
    eq('gratinados-only Margarita quantity is unchanged (none ordered as a gratinado)',
      findFlavor(after.gratinados, 'Margarita'), findFlavor(before.gratinados, 'Margarita'));

    approxEq('calzones-only Margarita quantity grew by 1',
      findFlavor(after.calzones, 'Margarita') - findFlavor(before.calzones, 'Margarita'), 1);

    const invalidCategory = await client.get('/api/analytics/flavors?range=today&category=pastas');
    check('an unsupported flavor category is rejected', invalidCategory.status === 400, JSON.stringify(invalidCategory.body));

    const productsAfter = (await client.get('/api/analytics/products?range=today')).body;
    check('no product row still uses the old "mitad y mitad" bucket name',
      !productsAfter.products.some((p: any) => p.name.toLowerCase().includes('mitad')),
      JSON.stringify(productsAfter.products.map((p: any) => p.name)));
    const pizzaRows = productsAfter.products.filter((p: any) => p.category === 'Pizzas');
    check('pizza rows are named "Pizza <size>" with no flavor baked into the name',
      pizzaRows.length > 0 && pizzaRows.every((p: any) => /^Pizza /.test(p.name) && !p.name.includes('Margarita') && !p.name.includes('Pepperoni')),
      JSON.stringify(pizzaRows.map((p: any) => p.name)));
  }

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
