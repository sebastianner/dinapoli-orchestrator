/* Audit suite 3: a simulated busy Friday night.
 *
 * Many concurrent WebSocket terminals place orders, grow them mid-service, and
 * settle them with realistic mixed payments; a few extra sockets sit idle as
 * "dashboard" screens so broadcast fan-out is realistic. Every order's price is
 * independently recomputed from the menu client-side and compared against what
 * the server charged, and every settlement is checked against what was paid.
 */
import fs from 'node:fs';
import { Client, Terminal, check, section, summary, results, sleep, warn } from './lib.js';

const TERMINALS = Number(process.env.BUSY_TERMINALS ?? 10);   // POS terminals placing orders
const DASHBOARDS = Number(process.env.BUSY_DASHBOARDS ?? 6);  // passive screens (kitchen display, manager dashboard)
const ORDERS = Number(process.env.BUSY_ORDERS ?? 260);        // orders across the whole service
/**
 * How many orders are settled at once. Settlement renders the bill through
 * headless Chromium, which is the one part of this system with no concurrency
 * limit of its own - measured behaviour is fine to 4, degrades hard at 8, and
 * collapses at 16 (see bill-concurrency.ts). The default keeps this suite
 * usable as a regression test; raise it to reproduce the collapse.
 */
const SETTLE_CONCURRENCY = Number(process.env.BUSY_SETTLE_CONCURRENCY ?? 4);
const OUT = process.env.AUDIT_OUT ?? '.';

const client = new Client();
type Menu = any;
let menu: Menu;
let promoSettings: Record<string, { price: number; sodaSurcharge: number }>;

// ---------------------------------------------------------------------------
// Independent client-side price model (deliberately re-derived from /api/menu
// rather than reusing anything the server computed, so a pricing bug shows up
// as a disagreement instead of being reproduced identically on both sides).
// ---------------------------------------------------------------------------

function pizzaCat() { return menu.menu.find((c: any) => c.id === 'pizzas'); }
function productCat(id: string) { return menu.menu.find((c: any) => c.id === id); }

function expectedPizzaPrice(size: string, flavorIds: string[]): number {
  const cat = pizzaCat();
  const special = cat.groups.find((g: any) => g.id === 'special');
  const isSpecial = flavorIds.some((f) => special.flavors.some((sf: any) => sf.id === f));
  const group = cat.groups.find((g: any) => g.id === (isSpecial ? 'special' : 'classic'));
  return group.sizes.find((s: any) => s.id === size).price;
}

function expectedProductPrice(categoryId: string, productId: string, sizeId?: string): number {
  const p = productCat(categoryId).products.find((x: any) => x.id === productId);
  if (p.sizes?.length) return p.sizes.find((s: any) => s.id === sizeId).price;
  return p.price;
}

/** Mirrors the documented promo rules independently of orderService.applyPromoPricing. */
const XL_SURCHARGE_FLAVORS = new Set(['coca_cola', 'quatro', 'premio']);

function expectedOrderTotal(req: any): number {
  const nonPromo = req.items.filter((i: any) => i.promoGroup == null);
  const promoItems = req.items.filter((i: any) => i.promoGroup != null);
  let total = 0;
  for (const it of nonPromo) {
    const unit = it.type === 'pizza'
      ? expectedPizzaPrice(it.size, it.flavors.map((f: any) => f.flavor))
      : expectedProductPrice(it.category, it.product, it.size);
    total += unit * it.quantity;
  }
  const promoType = req.promos?.[0];
  if (!promoType) return total;
  if (promoType === 'duo') return total + promoSettings.duo.price;
  // pizza_xl: flat price, plus a surcharge for three specific soda flavors
  const soda = promoItems.find((i: any) => i.type === 'product' && i.category === 'drinks');
  const surcharge = soda && XL_SURCHARGE_FLAVORS.has(soda.drinkFlavor) ? promoSettings.pizza_xl.sodaSurcharge : 0;
  return total + promoSettings.pizza_xl.price + surcharge;
}

// ---------------------------------------------------------------------------
// Random order generation
// ---------------------------------------------------------------------------

let seed = 20260801;
function rnd(): number { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function pick<T>(arr: T[]): T { return arr[Math.floor(rnd() * arr.length)] as T; }
function pickN<T>(arr: T[], n: number): T[] {
  const copy = [...arr]; const out: T[] = [];
  for (let i = 0; i < n && copy.length; i++) out.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
  return out;
}
function intBetween(a: number, b: number) { return a + Math.floor(rnd() * (b - a + 1)); }

let SIZES: string[]; let CLASSIC: string[]; let SPECIAL: string[]; let ALL_FLAVORS: string[];
let FLAT_PRODUCTS: { category: string; product: string; drinkFlavor?: string }[] = [];

function buildCatalog() {
  const cat = pizzaCat();
  const classicGroup = cat.groups.find((g: any) => g.id === 'classic');
  SIZES = classicGroup.sizes.filter((s: any) => s.price != null).map((s: any) => s.id);
  CLASSIC = classicGroup.flavors.filter((f: any) => f.isAvailable).map((f: any) => f.id);
  SPECIAL = cat.groups.find((g: any) => g.id === 'special').flavors.filter((f: any) => f.isAvailable).map((f: any) => f.id);
  ALL_FLAVORS = [...CLASSIC, ...SPECIAL];

  for (const c of menu.menu) {
    if (c.id === 'pizzas') continue;
    for (const p of c.products) {
      if (!p.isAvailable) continue;
      if (p.pizzaFlavor) continue;           // needs a flavor arg, handled separately
      if (p.sizes?.length) continue;         // sized, handled separately
      if (p.drinkFlavors?.length) {
        for (const f of p.drinkFlavors) FLAT_PRODUCTS.push({ category: c.id, product: p.id, drinkFlavor: f.id });
      } else {
        FLAT_PRODUCTS.push({ category: c.id, product: p.id });
      }
    }
  }
}

function maxFlavorsFor(size: string): number {
  const g = pizzaCat().groups.find((x: any) => x.id === 'classic');
  return g.sizes.find((s: any) => s.id === size).maxFlavors;
}

function randomPizza(): any {
  const size = pick(SIZES);
  const max = maxFlavorsFor(size);
  const n = intBetween(1, max);
  const flavors = pickN(ALL_FLAVORS, n);
  let portions: number[];
  if (n === 1) portions = [100];
  else if (n === 3 && rnd() < 0.5) portions = [50, 25, 25];
  else {
    const base = Math.floor(100 / n);
    portions = Array.from({ length: n }, (_, i) => (i === 0 ? base + (100 - base * n) : base));
  }
  return { type: 'pizza', size, flavors: flavors.map((f, i) => ({ flavor: f, portion: portions[i] })), quantity: intBetween(1, 2) };
}

function randomProduct(): any {
  const p = pick(FLAT_PRODUCTS);
  return { type: 'product', category: p.category, product: p.product, ...(p.drinkFlavor ? { drinkFlavor: p.drinkFlavor } : {}), quantity: intBetween(1, 3) };
}

function duoPromoItems() {
  const excluded = new Set(['campesina', 'madrilena', 'atarraya', 'tricaccio', 'ardiente']);
  const eligible = ALL_FLAVORS.filter((f) => !excluded.has(f));
  const pastas = productCat('pastas').products.filter((p: any) => p.id !== 'seafood').map((p: any) => p.id);
  return [
    { type: 'pizza', size: 'personal', flavors: [{ flavor: pick(eligible), portion: 100 }], quantity: 1, promoGroup: 0 },
    { type: 'product', category: 'pastas', product: pick(pastas), quantity: 1, promoGroup: 0 },
  ];
}

function xlPromoItems() {
  const sodaFlavors = productCat('drinks').products.find((p: any) => p.id === 'soft_drink_1_5l').drinkFlavors.map((f: any) => f.id);
  return [
    { type: 'pizza', size: 'xlarge', flavors: [{ flavor: pick(ALL_FLAVORS), portion: 100 }], quantity: 1, promoGroup: 0 },
    { type: 'product', category: 'drinks', product: 'soft_drink_1_5l', drinkFlavor: pick(sodaFlavors), quantity: 1, promoGroup: 0 },
    { type: 'product', category: 'appetizers', product: 'garlic_bread', quantity: 1, promoGroup: 0 },
  ];
}

// ---------------------------------------------------------------------------

interface Placed { id: number; request: any; expectedTotal: number; orderType: string; latencyMs: number }

async function main() {
  await client.loginAdmin(1, 'audit1234');
  menu = (await client.get('/api/menu')).body;
  const promos = (await client.get('/api/promos')).body;
  promoSettings = Object.fromEntries(promos.map((p: any) => [p.promoType, { price: p.price, sodaSurcharge: p.sodaSurcharge }]));
  buildCatalog();

  const tableCount = (await client.get('/api/tables')).body.length;
  const employees = (await client.get('/api/employees/active')).body.map((e: any) => e.id);
  const nbhs = (await client.get('/api/locations/cities/1/neighborhoods')).body;

  section('Setup: seeding customers with addresses');
  const customers: { id: number; addressId: number; fee: number }[] = [];
  for (let i = 0; i < 40; i++) {
    const c = (await client.post('/api/customers', { name: `Cliente ${i + 1}`, phone: `30${String(10000000 + i * 137).slice(0, 8)}` })).body;
    const n = nbhs[i % nbhs.length];
    const a = (await client.post(`/api/customers/${c.id}/addresses`, {
      streetAddress: `Calle ${10 + i} # ${i % 40} - ${i % 90}`,
      propertyType: i % 3 === 0 ? 'APARTMENT' : 'HOUSE',
      neighborhoodId: n.id,
      ...(i % 3 === 0 ? { buildingName: `Conjunto ${i}`, tower: String.fromCharCode(65 + (i % 5)), apartmentNumber: `${100 + i}` } : {}),
    })).body;
    customers.push({ id: c.id, addressId: a.id, fee: n.deliveryFee });
  }
  check('40 customers with addresses created', customers.length === 40);

  section(`Opening ${TERMINALS} POS terminals + ${DASHBOARDS} passive dashboards`);
  const terminals: Terminal[] = [];
  for (let i = 0; i < TERMINALS; i++) { const t = new Terminal(`pos-${i + 1}`); await t.connect(); terminals.push(t); }
  const dashboards: Terminal[] = [];
  for (let i = 0; i < DASHBOARDS; i++) { const t = new Terminal(`screen-${i + 1}`); await t.connect(); dashboards.push(t); }
  check('all sockets connected', terminals.length === TERMINALS && dashboards.length === DASHBOARDS);

  // -------------------------------------------------------------------------
  section(`Phase 1: ${ORDERS} orders placed concurrently across ${TERMINALS} terminals`);
  const placed: Placed[] = [];
  const rejected: { request: any; message: string }[] = [];
  const t0 = Date.now();

  const requests: any[] = [];
  for (let i = 0; i < ORDERS; i++) {
    const roll = rnd();
    const employeeId = pick(employees);
    let items: any[]; let promoType: string | undefined;

    if (roll < 0.12) { items = duoPromoItems(); promoType = 'duo'; if (rnd() < 0.4) items.push(randomProduct()); }
    else if (roll < 0.20) { items = xlPromoItems(); promoType = 'pizza_xl'; if (rnd() < 0.3) items.push(randomProduct()); }
    else {
      const nItems = intBetween(1, 5);
      items = Array.from({ length: nItems }, () => (rnd() < 0.55 ? randomPizza() : randomProduct()));
    }

    const typeRoll = rnd();
    let req: any;
    if (typeRoll < 0.45) req = { orderType: 'dine_in', employeeId, tableNumber: intBetween(1, tableCount), items };
    else if (typeRoll < 0.68) { const c = pick(customers); req = { orderType: 'takeaway', employeeId, customerId: c.id, items }; }
    else { const c = pick(customers); req = { orderType: 'delivery', employeeId, customerId: c.id, customerAddressId: c.addressId, items, _fee: c.fee }; }
    if (promoType) req.promos = [promoType];
    if (rnd() < 0.15) req.notes = 'Sin cebolla, por favor. Mesa con niños.';
    requests.push(req);
  }

  // Fan the orders out across terminals, all in flight at once - this is the burst.
  await Promise.all(requests.map(async (req, i) => {
    const term = terminals[i % TERMINALS];
    const fee = req._fee; delete req._fee;
    const start = Date.now();
    const reply = await term.place(req, 60000);
    const latencyMs = Date.now() - start;
    if (reply.type === 'order_created') {
      placed.push({ id: reply.order.id, request: req, expectedTotal: expectedOrderTotal(req), orderType: req.orderType, latencyMs });
      (req as any)._suggestedFee = fee;
    } else {
      rejected.push({ request: req, message: reply.message ?? '' });
    }
  }));
  const placeMs = Date.now() - t0;

  check('every generated order was accepted', rejected.length === 0,
    rejected.slice(0, 5).map((r) => r.message).join(' | '));
  console.log(`  placed ${placed.length} orders in ${placeMs}ms (${(placed.length / (placeMs / 1000)).toFixed(1)} orders/s)`);
  const lats = placed.map((p) => p.latencyMs).sort((a, b) => a - b);
  console.log(`  ack latency p50=${lats[Math.floor(lats.length * 0.5)]}ms p95=${lats[Math.floor(lats.length * 0.95)]}ms max=${lats[lats.length - 1]}ms`);

  section('Phase 1 verification: independently recomputed prices');
  let priceMismatches = 0;
  for (const p of placed) {
    const server = (await client.get(`/api/orders/${p.id}`)).body;
    if (server.total !== p.expectedTotal) {
      priceMismatches++;
      if (priceMismatches <= 5) {
        console.log(`    order ${p.id}: server charged ${server.total}, menu says ${p.expectedTotal}`);
        console.log(`      request: ${JSON.stringify(p.request)}`);
      }
    }
  }
  check('server total matches an independent recomputation from the menu, for every order', priceMismatches === 0, `${priceMismatches} mismatches`);

  section('Phase 2: kitchen queue drains everything to ACTIVE');
  const drainStart = Date.now();
  let activeCount = 0;
  for (let attempt = 0; attempt < 240; attempt++) {
    const r = await client.get('/api/orders?status=ACTIVE');
    activeCount = r.body.length;
    if (activeCount >= placed.length) break;
    await sleep(500);
  }
  const drainMs = Date.now() - drainStart;
  check('every placed order reached ACTIVE (kitchen ticket printed)', activeCount >= placed.length, `active=${activeCount} placed=${placed.length}`);
  console.log(`  queue drained ${placed.length} tickets in ${drainMs}ms`);
  const stuck = (await client.get('/api/orders?status=PRINTING')).body;
  check('no order left stuck in PRINTING', stuck.length === 0, `${stuck.length} stuck: ${stuck.map((o: any) => o.id).join(',')}`);

  section('Phase 3: mid-service additions to open orders');
  const toGrow = pickN(placed, 45);
  let growFailures = 0;
  await Promise.all(toGrow.map(async (p) => {
    const extra = [randomProduct()];
    const before = (await client.get(`/api/orders/${p.id}`)).body;
    const r = await client.patch(`/api/orders/${p.id}/items`, { addItems: extra });
    if (r.status !== 200) { growFailures++; return; }
    const addedExpected = expectedProductPrice(extra[0].category, extra[0].product) * extra[0].quantity;
    if (r.body.total !== before.total + addedExpected) {
      growFailures++;
      console.log(`    order ${p.id}: total ${before.total} + ${addedExpected} should be ${before.total + addedExpected}, got ${r.body.total}`);
    }
    p.expectedTotal = before.total + addedExpected;
  }));
  check('every mid-service addition priced and summed correctly', growFailures === 0, `${growFailures} failures`);

  // Let the addendum tickets print.
  for (let attempt = 0; attempt < 120; attempt++) {
    const r = await client.get('/api/orders?status=ACTIVE');
    if (r.body.length >= placed.length) break;
    await sleep(500);
  }

  section('Phase 4: register expenses during service');
  // Measured as a delta, not against a pristine register - when this runs inside
  // run-all.ts the earlier suites have already touched the cash flow.
  const cfBefore = (await client.get('/api/cash-flow/current')).body;
  const expenses = [[45000, 'Compra de queso mozzarella'], [18000, 'Domicilio insumos'], [30000, 'Gas cocina']] as const;
  for (const [amount, justification] of expenses) {
    const r = await client.post('/api/cash-flow/expenses', { amount, justification });
    check(`expense "${justification}" recorded`, r.status === 200 || r.status === 201, JSON.stringify(r.body));
  }
  const cf = (await client.get('/api/cash-flow/current')).body;
  const expectedExpenses = expenses.reduce((s, e) => s + e[0], 0);
  check('the period expense total grew by exactly what was recorded',
    cf.expenses - cfBefore.expenses === expectedExpenses, `${cf.expenses - cfBefore.expenses} vs ${expectedExpenses}`);
  check('available cash dropped by exactly the same amount',
    cfBefore.cashInRegister - cf.cashInRegister === expectedExpenses, `${cfBefore.cashInRegister - cf.cashInRegister} vs ${expectedExpenses}`);

  section('Phase 5: settling every order with mixed payments');
  interface Settled { id: number; total: number; tip: number; fee: number; discount: number; splits: any[] }
  const settled: Settled[] = [];
  const settleStart = Date.now();
  let settleFailures = 0;

  const settleOne = async (p: Placed) => {
    const order = (await client.get(`/api/orders/${p.id}`)).body;
    const total = order.total;

    // Realistic extras: tips on ~30%, delivery fees on delivery orders, occasional discounts.
    const tip = rnd() < 0.30 ? Math.round((total * (rnd() < 0.5 ? 0.05 : 0.10)) / 100) * 100 : 0;
    const fee = order.orderType === 'delivery' ? ((p.request as any)._suggestedFee ?? 6000) : 0;
    const discount = rnd() < 0.12 ? Math.min(total, intBetween(1, 20) * 500) : 0;
    const grandTotal = total + tip + fee;

    let splits: any[];
    if (rnd() < 0.25 && grandTotal > 20000) {
      // Mixed payment: cash covers a chunk, the second method carries the tip + fee + discount.
      const cashPart = Math.floor((grandTotal - tip - fee) / 2);
      const other = pick(['card', 'transfer', 'rappi']);
      splits = [
        { method: 'cash', grossAmount: cashPart },
        { method: other, grossAmount: grandTotal - cashPart, tipAmount: tip, deliveryFee: fee, discount },
      ];
    } else {
      splits = [{ method: pick(['cash', 'card', 'transfer', 'rappi']), grossAmount: grandTotal, tipAmount: tip, deliveryFee: fee, discount }];
    }

    const r = await client.post(`/api/orders/${p.id}/complete`, { payments: splits });
    if (r.status !== 200) {
      settleFailures++;
      if (settleFailures <= 5) console.log(`    settle failed for ${p.id}: ${r.status} ${JSON.stringify(r.body)} :: ${JSON.stringify(splits)}`);
      return;
    }
    settled.push({ id: p.id, total, tip, fee, discount, splits });
  };

  console.log(`  settling ${placed.length} orders, ${SETTLE_CONCURRENCY} at a time`);
  for (let i = 0; i < placed.length; i += SETTLE_CONCURRENCY) {
    await Promise.all(placed.slice(i, i + SETTLE_CONCURRENCY).map(settleOne));
  }
  const settleMs = Date.now() - settleStart;
  check('every order settled', settleFailures === 0, `${settleFailures} failures`);
  console.log(`  settled ${settled.length} orders in ${settleMs}ms (${(settled.length / (settleMs / 1000)).toFixed(1)} orders/s, bills rasterized via Chromium)`);

  section('Phase 6: per-order settlement invariants (all orders)');
  let bad = 0;
  const allOrders = (await client.get('/api/orders?status=COMPLETED')).body;
  for (const o of allOrders) {
    const itemsSum = o.items.reduce((s: number, i: any) => s + i.unitPrice * i.quantity, 0);
    const gross = o.payments.reduce((s: number, p: any) => s + p.grossAmount, 0);
    const net = o.payments.reduce((s: number, p: any) => s + p.netAmount, 0);
    const tip = o.payments.reduce((s: number, p: any) => s + p.tipAmount, 0);
    const fee = o.payments.reduce((s: number, p: any) => s + p.deliveryFee, 0);
    const disc = o.payments.reduce((s: number, p: any) => s + p.discount, 0);
    const problems: string[] = [];
    if (itemsSum !== o.total) problems.push(`items ${itemsSum} != total ${o.total}`);
    if (o.grandTotal !== o.total + o.tip + o.deliveryFee) problems.push('grandTotal mismatch');
    if (gross !== o.grandTotal) problems.push(`gross ${gross} != grandTotal ${o.grandTotal}`);
    if (net !== o.total) problems.push(`net ${net} != total ${o.total}`);
    if (tip !== o.tip || fee !== o.deliveryFee || disc !== o.discount) problems.push('tip/fee/discount rollup mismatch');
    if (o.payments.some((p: any) => p.netAmount !== p.grossAmount - p.tipAmount - p.deliveryFee)) problems.push('netAmount formula');
    if (o.payments.some((p: any) => p.discount > p.netAmount)) problems.push('discount exceeds net');
    if (problems.length) { bad++; if (bad <= 5) console.log(`    order ${o.id}: ${problems.join('; ')}`); }
  }
  check(`all ${allOrders.length} completed orders satisfy every settlement invariant`, bad === 0, `${bad} bad orders`);

  section('Phase 7: broadcast fan-out');
  const perDashboard = dashboards.map((d) => d.broadcasts.filter((b) => b.type === 'order_updated').length);
  console.log(`  order_updated broadcasts seen per passive screen: ${perDashboard.join(', ')}`);
  const spread = Math.max(...perDashboard) - Math.min(...perDashboard);
  check('every connected screen received the same broadcast stream', spread === 0, `spread of ${spread} messages between screens`);
  const totalBroadcastsOneScreen = dashboards[0].broadcasts.length;
  console.log(`  ${totalBroadcastsOneScreen} broadcasts per screen for ${placed.length} orders ` +
    `(~${(totalBroadcastsOneScreen / placed.length).toFixed(1)} per order, x${TERMINALS + DASHBOARDS} sockets ` +
    `= ${(totalBroadcastsOneScreen * (TERMINALS + DASHBOARDS)).toLocaleString()} messages sent)`);

  // Persist the run's ledger so the reporting suite can cross-check it.
  fs.writeFileSync(`${OUT}/busy-day-ledger.json`, JSON.stringify({ settled, placedCount: placed.length, expectedExpenses }, null, 1));

  for (const t of [...terminals, ...dashboards]) t.close();
  summary();
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
