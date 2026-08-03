/* Audit suite 2: settlement math - subtotal, discount, tip, delivery fee,
   grand total, split payments, and what actually gets charged vs. recorded. */
import { Client, Terminal, check, eq, section, summary, results, pizza, product, warn, waitForStatus, sleep } from './lib.js';

const EMP_ADMIN = 1;
const EMP_STAFF = 2;
const client = new Client();
let term: Terminal;

async function newActiveOrder(items: any[], extra: Record<string, unknown> = {}): Promise<any> {
  const r = await term.place({ orderType: 'dine_in', employeeId: EMP_STAFF, tableNumber: 1, items, ...extra });
  if (r.type !== 'order_created') throw new Error(`order rejected: ${r.message}`);
  return waitForStatus(client, r.order.id, 'ACTIVE');
}

async function newActiveDelivery(customerId: number, addressId: number, items: any[]): Promise<any> {
  const r = await term.place({ orderType: 'delivery', employeeId: EMP_STAFF, customerId, customerAddressId: addressId, items });
  if (r.type !== 'order_created') throw new Error(`delivery order rejected: ${r.message}`);
  return waitForStatus(client, r.order.id, 'ACTIVE');
}

function fullInvariants(label: string, order: any) {
  const itemsSum = order.items.reduce((s: number, i: any) => s + i.unitPrice * i.quantity, 0);
  check(`${label}: items sum to order.total`, itemsSum === order.total, `items=${itemsSum} total=${order.total}`);
  check(`${label}: grandTotal = total + tip + fee`, order.grandTotal === order.total + order.tip + order.deliveryFee);
  const gross = order.payments.reduce((s: number, p: any) => s + p.grossAmount, 0);
  const net = order.payments.reduce((s: number, p: any) => s + p.netAmount, 0);
  const tip = order.payments.reduce((s: number, p: any) => s + p.tipAmount, 0);
  const fee = order.payments.reduce((s: number, p: any) => s + p.deliveryFee, 0);
  const disc = order.payments.reduce((s: number, p: any) => s + p.discount, 0);
  check(`${label}: sum(gross) = grandTotal`, gross === order.grandTotal, `gross=${gross} grand=${order.grandTotal}`);
  check(`${label}: sum(net) = order.total`, net === order.total, `net=${net} total=${order.total}`);
  check(`${label}: sum(tipAmount) = order.tip`, tip === order.tip);
  check(`${label}: sum(deliveryFee) = order.deliveryFee`, fee === order.deliveryFee);
  check(`${label}: sum(discount) = order.discount`, disc === order.discount);
  // What the customer actually hands over.
  const collected = order.payments.reduce((s: number, p: any) => s + (p.grossAmount - p.discount), 0);
  check(`${label}: cash collected = grandTotal - discount`, collected === order.grandTotal - order.discount,
    `collected=${collected} expected=${order.grandTotal - order.discount}`);
}

async function main() {
  await client.loginAdmin(EMP_ADMIN, 'audit1234');
  term = new Terminal('money');
  await term.connect();

  const cust = (await client.post('/api/customers', { name: 'Pagos Cliente', phone: '3011112222' })).body;
  const nbhs = (await client.get(`/api/locations/cities/1/neighborhoods`)).body;
  const addr = (await client.post(`/api/customers/${cust.id}/addresses`, {
    streetAddress: 'Cra 44 # 8-20', propertyType: 'APARTMENT', neighborhoodId: nbhs[0].id,
    buildingName: 'Torres del Sol', tower: 'B', apartmentNumber: '904',
  })).body;

  // -------------------------------------------------------------------------
  section('A. Single-method settlement, no extras');
  let o = await newActiveOrder([pizza('large', [{ flavor: 'margherita', portion: 100 }])]); // 66000
  let r = await client.post(`/api/orders/${o.id}/complete`, { payments: [{ method: 'cash', grossAmount: 66000 }] });
  check('exact cash payment completes the order', r.status === 200, JSON.stringify(r.body));
  eq('status becomes COMPLETED', r.body.status, 'COMPLETED');
  fullInvariants('cash-exact', r.body);
  eq('no tip recorded', r.body.tip, 0);
  eq('grandTotal equals subtotal when there are no extras', r.body.grandTotal, 66000);

  section('B. Underpayment / overpayment are refused');
  o = await newActiveOrder([pizza('large', [{ flavor: 'margherita', portion: 100 }])]);
  r = await client.post(`/api/orders/${o.id}/complete`, { payments: [{ method: 'cash', grossAmount: 65999 }] });
  check('paying 1 COP short is refused', r.status >= 400, JSON.stringify(r.body));
  r = await client.post(`/api/orders/${o.id}/complete`, { payments: [{ method: 'cash', grossAmount: 66001 }] });
  check('paying 1 COP over is refused', r.status >= 400, JSON.stringify(r.body));
  r = await client.post(`/api/orders/${o.id}/complete`, { payments: [] });
  check('an empty payments array is refused', r.status >= 400, JSON.stringify(r.body));
  r = await client.post(`/api/orders/${o.id}/complete`, {});
  check('a missing payments array is refused', r.status >= 400, JSON.stringify(r.body));
  r = await client.post(`/api/orders/${o.id}/complete`, { payments: [{ method: 'bitcoin', grossAmount: 66000 }] });
  check('an unknown payment method is refused', r.status >= 400, JSON.stringify(r.body));
  r = await client.post(`/api/orders/${o.id}/complete`, { payments: [{ method: 'cash', grossAmount: 66000.5 }] });
  check('a fractional amount is refused', r.status >= 400, JSON.stringify(r.body));
  r = await client.post(`/api/orders/${o.id}/complete`, { payments: [{ method: 'cash', grossAmount: -66000 }] });
  check('a negative amount is refused', r.status >= 400, JSON.stringify(r.body));
  const stillOpen = (await client.get(`/api/orders/${o.id}`)).body;
  eq('every refused attempt leaves the order ACTIVE', stillOpen.status, 'ACTIVE');
  eq('no orphan payment rows were written by refused attempts', stillOpen.payments.length, 0);

  section('C. Tips');
  // 66000 items + 10000 tip
  r = await client.post(`/api/orders/${o.id}/complete`, { payments: [{ method: 'card', grossAmount: 76000, tipAmount: 10000 }] });
  check('card payment with a tip completes', r.status === 200, JSON.stringify(r.body));
  fullInvariants('card+tip', r.body);
  eq('tip is recorded', r.body.tip, 10000);
  eq('tip is excluded from order.total', r.body.total, 66000);
  eq('grandTotal includes the tip', r.body.grandTotal, 76000);
  eq('payment netAmount is the products-only slice', r.body.payments[0].netAmount, 66000);

  o = await newActiveOrder([pizza('large', [{ flavor: 'margherita', portion: 100 }])]);
  r = await client.post(`/api/orders/${o.id}/complete`, { payments: [{ method: 'cash', grossAmount: 66000, tipAmount: 70000 }] });
  check('a tip larger than the amount charged on that split is refused', r.status >= 400, JSON.stringify(r.body));
  r = await client.post(`/api/orders/${o.id}/complete`, { payments: [{ method: 'cash', grossAmount: 66000, tipAmount: -5000 }] });
  check('a negative tip is refused', r.status >= 400, JSON.stringify(r.body));

  section('D. Mixed payments with a method-targeted tip');
  // items 66000; 20000 cash + (46000 items + 8000 tip) on card
  r = await client.post(`/api/orders/${o.id}/complete`, {
    payments: [
      { method: 'cash', grossAmount: 20000 },
      { method: 'card', grossAmount: 54000, tipAmount: 8000 },
    ],
  });
  check('mixed cash+card with a card-only tip completes', r.status === 200, JSON.stringify(r.body));
  fullInvariants('mixed+tip', r.body);
  eq('order tip is the sum of the splits', r.body.tip, 8000);
  eq('cash split stays pure sales', r.body.payments[0].netAmount, 20000);
  eq('card split nets out its own tip', r.body.payments[1].netAmount, 46000);
  eq('grandTotal covers items + tip', r.body.grandTotal, 74000);

  o = await newActiveOrder([pizza('large', [{ flavor: 'margherita', portion: 100 }])]);
  r = await client.post(`/api/orders/${o.id}/complete`, {
    payments: [{ method: 'cash', grossAmount: 30000 }, { method: 'card', grossAmount: 30000 }],
  });
  check('splits that do not add up to the total are refused', r.status >= 400, JSON.stringify(r.body));

  section('E. Delivery fees');
  let d = await newActiveDelivery(cust.id, addr.id, [pizza('medium', [{ flavor: 'margherita', portion: 100 }])]); // 52000
  r = await client.post(`/api/orders/${d.id}/complete`, { payments: [{ method: 'cash', grossAmount: 59000, deliveryFee: 7000 }] });
  check('delivery order with a fee completes', r.status === 200, JSON.stringify(r.body));
  fullInvariants('delivery+fee', r.body);
  eq('delivery fee is recorded', r.body.deliveryFee, 7000);
  eq('delivery fee is excluded from order.total', r.body.total, 52000);
  eq('grandTotal includes the delivery fee', r.body.grandTotal, 59000);
  eq('netAmount excludes the delivery fee', r.body.payments[0].netAmount, 52000);

  o = await newActiveOrder([pizza('medium', [{ flavor: 'margherita', portion: 100 }])]);
  r = await client.post(`/api/orders/${o.id}/complete`, { payments: [{ method: 'cash', grossAmount: 59000, deliveryFee: 7000 }] });
  check('a delivery fee on a dine_in order is refused', r.status >= 400, JSON.stringify(r.body));

  section('F. Delivery with fee + tip + discount together');
  d = await newActiveDelivery(cust.id, addr.id, [pizza('xlarge', [{ flavor: 'pepperoni', portion: 100 }])]); // 86000 special XL
  // 86000 items + 7000 fee + 5000 tip = 98000 gross; 10000 discount off products
  r = await client.post(`/api/orders/${d.id}/complete`, {
    payments: [{ method: 'card', grossAmount: 98000, tipAmount: 5000, deliveryFee: 7000, discount: 10000 }],
  });
  check('fee + tip + discount together completes', r.status === 200, JSON.stringify(r.body));
  fullInvariants('fee+tip+discount', r.body);
  eq('subtotal untouched by discount', r.body.total, 86000);
  eq('tip recorded', r.body.tip, 5000);
  eq('fee recorded', r.body.deliveryFee, 7000);
  eq('discount recorded', r.body.discount, 10000);
  eq('grandTotal is the PRE-discount figure', r.body.grandTotal, 98000);
  check('amount actually collected = 88000', r.body.payments[0].grossAmount - r.body.payments[0].discount === 88000,
    `${r.body.payments[0].grossAmount - r.body.payments[0].discount}`);

  section('G. Discount bounds');
  o = await newActiveOrder([pizza('medium', [{ flavor: 'margherita', portion: 100 }])]); // 52000
  r = await client.post(`/api/orders/${o.id}/complete`, { payments: [{ method: 'cash', grossAmount: 52000, discount: 52001 }] });
  check('a discount larger than the products slice is refused', r.status >= 400, JSON.stringify(r.body));
  r = await client.post(`/api/orders/${o.id}/complete`, { payments: [{ method: 'cash', grossAmount: 57000, tipAmount: 5000, discount: 52001 }] });
  check('a discount cannot eat into the tip', r.status >= 400, JSON.stringify(r.body));
  r = await client.post(`/api/orders/${o.id}/complete`, { payments: [{ method: 'cash', grossAmount: 52000, discount: -1000 }] });
  check('a negative discount is refused', r.status >= 400, JSON.stringify(r.body));

  const fullDiscount = await client.post(`/api/orders/${o.id}/complete`, { payments: [{ method: 'cash', grossAmount: 52000, discount: 52000 }] });
  if (fullDiscount.status === 200) {
    fullInvariants('100% discount', fullDiscount.body);
    check('a 100% discount collects 0', fullDiscount.body.payments[0].grossAmount - fullDiscount.body.payments[0].discount === 0);
  } else {
    warn('100% discount', `refused with ${fullDiscount.status}: ${JSON.stringify(fullDiscount.body)}`);
  }

  section('H. Status guards on completion');
  // An order can only be settled from ACTIVE. Rather than racing the queue
  // worker for a genuinely-PENDING order, force the state directly: a COMPLETED
  // order must refuse a second settlement, and so must a PENDING one.
  const pendingProbe = await term.place({ orderType: 'dine_in', employeeId: EMP_STAFF, tableNumber: 2, items: [product('appetizers', 'garlic_bread')] });
  const pid = pendingProbe.order.id;
  await waitForStatus(client, pid, 'ACTIVE');
  // Racing the queue worker for a genuinely-PENDING order is flaky (it can print
  // in under a millisecond), so the state is forced directly instead.
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(`${process.env.DINAPOLI_DATA_DIR}/dinapoli.sqlite`);
  db.prepare("UPDATE orders SET status='PENDING' WHERE id=?").run(pid);
  const whileNotPrinted = await client.post(`/api/orders/${pid}/complete`, { payments: [{ method: 'cash', grossAmount: 10000 }] });
  db.close();
  check('an order awaiting its kitchen ticket cannot be settled', whileNotPrinted.status >= 400,
    `status ${whileNotPrinted.status}: ${JSON.stringify(whileNotPrinted.body).slice(0, 160)}`);
  await waitForStatus(client, pid, 'ACTIVE').catch(() => {});

  const done = await waitForStatus(client, (await newActiveOrder([product('appetizers', 'garlic_bread')])).id, 'ACTIVE');
  await client.post(`/api/orders/${done.id}/complete`, { payments: [{ method: 'cash', grossAmount: 10000 }] });
  const twice = await client.post(`/api/orders/${done.id}/complete`, { payments: [{ method: 'cash', grossAmount: 10000 }] });
  check('double-completing the same order is refused', twice.status >= 400, JSON.stringify(twice.body));
  const afterTwice = (await client.get(`/api/orders/${done.id}`)).body;
  eq('no duplicate payment row after a refused second completion', afterTwice.payments.length, 1);

  const addAfterComplete = await client.post(`/api/orders/${done.id}/items`, { items: [product('appetizers', 'garlic_bread')] });
  check('adding items to a COMPLETED order is refused', addAfterComplete.status >= 400, JSON.stringify(addAfterComplete.body));

  section('I. Correcting an already-recorded payment split');
  const corrected = await client.put(`/api/orders/${done.id}/payments`, {
    payments: [{ method: 'cash', grossAmount: 4000 }, { method: 'transfer', grossAmount: 6000 }],
  });
  check('splitting a recorded payment after the fact works', corrected.status === 200, JSON.stringify(corrected.body));
  fullInvariants('corrected split', corrected.body);
  eq('the corrected split replaces the old rows wholesale', corrected.body.payments.length, 2);
  const badCorrection = await client.put(`/api/orders/${done.id}/payments`, { payments: [{ method: 'cash', grossAmount: 999 }] });
  check('a correction that does not add up is refused', badCorrection.status >= 400, JSON.stringify(badCorrection.body));
  const afterBadCorrection = (await client.get(`/api/orders/${done.id}`)).body;
  eq('a refused correction leaves the previous split intact', afterBadCorrection.payments.length, 2);

  const openOrder = await newActiveOrder([product('appetizers', 'garlic_bread')]);
  const editOpen = await client.put(`/api/orders/${openOrder.id}/payments`, { payments: [{ method: 'cash', grossAmount: 10000 }] });
  check('editing payments on a still-open order is refused', editOpen.status >= 400, JSON.stringify(editOpen.body));
  await client.post(`/api/orders/${openOrder.id}/complete`, { payments: [{ method: 'cash', grossAmount: 10000 }] });

  section('J. Items added after the bill was already partially built');
  const grow = await newActiveOrder([pizza('small', [{ flavor: 'margherita', portion: 100 }])]); // 34000
  await client.post(`/api/orders/${grow.id}/items`, { items: [product('drinks', 'soft_drink', { drinkFlavor: 'agua' })] }); // +5000
  await waitForStatus(client, grow.id, 'ACTIVE');
  const stale = await client.post(`/api/orders/${grow.id}/complete`, { payments: [{ method: 'cash', grossAmount: 34000 }] });
  check('paying the pre-addition total is refused', stale.status >= 400, JSON.stringify(stale.body));
  const paidGrown = await client.post(`/api/orders/${grow.id}/complete`, { payments: [{ method: 'cash', grossAmount: 39000 }] });
  check('paying the post-addition total succeeds', paidGrown.status === 200, JSON.stringify(paidGrown.body));
  fullInvariants('grown order', paidGrown.body);

  section('K. Table lifecycle around payment');
  // Uses a table no earlier section touched - the rest of this suite deliberately
  // leaves refused-settlement orders open on table 1, which would legitimately
  // keep it busy and make "does it free?" untestable there.
  const tableCount = (await client.get('/api/tables')).body.length;
  const TABLE = tableCount; // the highest table, untouched above
  const onTable = async (items: any[]) => {
    const r = await term.place({ orderType: 'dine_in', employeeId: EMP_STAFF, tableNumber: TABLE, items });
    if (r.type !== 'order_created') throw new Error(`order rejected: ${r.message}`);
    return waitForStatus(client, r.order.id, 'ACTIVE');
  };
  const statusOf = async () => (await client.get('/api/tables')).body.find((t: any) => t.number === TABLE).status;

  eq(`table ${TABLE} starts free`, await statusOf(), 'free');
  const tableOrderA = await onTable([product('appetizers', 'garlic_bread')]);
  eq(`table ${TABLE} is busy while an order is open`, await statusOf(), 'busy');
  const tableOrderB = await onTable([product('appetizers', 'garlic_bread')]);
  await client.post(`/api/orders/${tableOrderA.id}/complete`, { payments: [{ method: 'cash', grossAmount: 10000 }] });
  eq('table stays busy while a second order on it is still open', await statusOf(), 'busy');
  await client.post(`/api/orders/${tableOrderB.id}/complete`, { payments: [{ method: 'cash', grossAmount: 10000 }] });
  eq('table frees once its last order is settled', await statusOf(), 'free');

  term.close();
  summary();
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
