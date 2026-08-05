/* Audit suite 6: printed documents.
 *
 * Runs against the emulated printer (PRINTER_EMULATION_DIR), reading back the
 * exact byte stream each job produced. Checks routing (kitchen vs counter),
 * addendum behaviour, the promo price label, and the bill's arithmetic.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Client, Terminal, check, eq, section, summary, results, warn, waitForStatus, sleep, pizza, product } from './lib.js';

const client = new Client();
const PRINTOUTS = process.env.PRINTER_EMULATION_DIR!;
let term: Terminal;

function jobsSince(marker: number): { file: string; queue: string; text: string }[] {
  return fs.readdirSync(PRINTOUTS)
    .filter((f) => f.endsWith('.txt') && /^\d{5}-/.test(f))
    .filter((f) => Number(f.slice(0, 5)) > marker)
    .sort()
    .map((f) => ({
      file: f,
      queue: f.replace(/^\d{5}-/, '').replace(/\.txt$/, ''),
      text: fs.readFileSync(path.join(PRINTOUTS, f), 'latin1'),
    }));
}

function currentMarker(): number {
  const nums = fs.readdirSync(PRINTOUTS).filter((f) => /^\d{5}-.*\.txt$/.test(f)).map((f) => Number(f.slice(0, 5)));
  return nums.length ? Math.max(...nums) : 0;
}

async function place(req: any) {
  const r = await term.place(req);
  if (r.type !== 'order_created') throw new Error(`rejected: ${r.message}`);
  return waitForStatus(client, r.order.id, 'ACTIVE');
}

async function main() {
  await client.loginAdmin(1, 'audit1234');
  term = new Terminal('print');
  await term.connect();
  const emp = (await client.get('/api/employees/active')).body[1].id;
  const dineIn = (items: any[], extra: any = {}) => ({ orderType: 'dine_in', employeeId: emp, tableNumber: 5, items, ...extra });

  // -------------------------------------------------------------------------
  section('A. Kitchen ticket routing and content');
  let m = currentMarker();
  const o1 = await place(dineIn([
    pizza('large', [{ flavor: 'margherita', portion: 50 }, { flavor: 'pepperoni', portion: 50 }]),
    product('drinks', 'soft_drink', { drinkFlavor: 'agua', quantity: 2 }),
  ], { notes: 'Mesa junto a la ventana' }));
  await sleep(500);
  let jobs = jobsSince(m);
  eq('exactly one job printed for a new order', jobs.length, 1);
  eq('it goes to the kitchen printer', jobs[0].queue, 'kitchen_printer');
  const t1 = jobs[0].text;
  check('ticket has the COMANDA header', t1.includes('COMANDA'), t1.slice(0, 120));
  check('ticket shows the order number', t1.includes(`Orden #${o1.id}`));
  check('order type is bold', t1.includes('<B>En mesa</B>'));
  check('table number is bold', t1.includes('<B>Mesa: 5</B>'));
  check('half-and-half fractions are printed', t1.includes('(1/2)'), t1);
  // Wrapped across lines at the 24-column limit, so compare on collapsed whitespace.
  check('order notes reach the kitchen', t1.replace(/\s+/g, ' ').includes('Notas: Mesa junto a la ventana'), t1);
  check('quantities are merged onto one line', t1.includes('2x '), t1);
  check('ticket carries no prices (kitchen does not need them)', !t1.includes('$'), t1);
  // Date and time are separate lines: "Fecha: 01/08/2026, 19:16:56" is 27
  // characters against a 24-column double-width line and always wrapped.
  check('the date prints on its own unwrapped line', /^Fecha: \d{2}\/\d{2}\/\d{4}$/m.test(t1), t1);
  check('the time prints on its own unwrapped line', /^Hora: \d{2}:\d{2}$/m.test(t1), t1);
  const bodyLines = t1
    .split('\n')
    .map((l) => l.replace(/<\/?B>/g, '').replace(/<[A-Z][^>]*>/g, '')) // drop the decoder's own command markers
    .filter((l) => l.trim() !== '');
  check('every ticket line fits 24 double-width columns',
    bodyLines.every((l) => l.length <= 24),
    bodyLines.filter((l) => l.length > 24).join(' || '));

  section('B. Addendum ticket for items added mid-service');
  m = currentMarker();
  await client.post(`/api/orders/${o1.id}/items`, { items: [product('desserts', 'ice_cream', { quantity: 2 })] });
  await waitForStatus(client, o1.id, 'ACTIVE');
  await sleep(600);
  jobs = jobsSince(m);
  eq('adding items prints exactly one more job', jobs.length, 1);
  eq('the addendum goes to the kitchen printer', jobs[0].queue, 'kitchen_printer');
  const t2 = jobs[0].text;
  check('it is labelled as an addition', t2.includes('ADICION A COMANDA'), t2.slice(0, 200));
  check('it lists only the new item', t2.includes('Helado') || t2.includes('Ice'), t2);
  check('it does NOT re-list the original pizza', !t2.includes('Pizza'), t2);

  section('C. The saved snapshot grows to the full order');
  m = currentMarker();
  const rp = await client.post(`/api/orders/${o1.id}/reprint`, { kind: 'kitchen_ticket' });
  check('reprint succeeds', rp.status === 200, JSON.stringify(rp.body));
  await sleep(400);
  jobs = jobsSince(m);
  eq('reprint emits one job', jobs.length, 1);
  eq('a kitchen-ticket reprint is routed to the counter, not the kitchen line', jobs[0].queue, 'counter_printer');
  const t3 = jobs[0].text;
  check('the reprinted snapshot contains the original items', t3.includes('Pizza'), t3);
  check('the reprinted snapshot also contains the later addition', t3.includes('Helado') || t3.includes('Ice'), t3);

  section('D. No item is ever printed twice');
  const dbOrder = (await client.get(`/api/orders/${o1.id}`)).body;
  check('every item carries a printed_at stamp', dbOrder.items.every((i: any) => i.printedAt != null),
    JSON.stringify(dbOrder.items.map((i: any) => i.printedAt)));
  m = currentMarker();
  await sleep(2500); // more than one queue poll interval
  eq('an ACTIVE order is not re-picked-up by the queue worker', jobsSince(m).length, 0);

  // -------------------------------------------------------------------------
  section('E. Promo label on the kitchen ticket');
  const promos = (await client.get('/api/promos')).body;
  const duoPrice = promos.find((p: any) => p.promoType === 'duo').price;
  const xlPrice = promos.find((p: any) => p.promoType === 'pizza_xl').price;

  // E1: duo promo alone - label should read the promo price.
  m = currentMarker();
  await place(dineIn([
    pizza('personal', [{ flavor: 'margherita', portion: 100 }], { promoItem: true }),
    product('pastas', 'alfredo', { promoItem: true }),
  ], { promoType: 'duo' }));
  await sleep(500);
  let label = jobsSince(m)[0].text.split('\n').find((l) => l.includes('PROMO')) ?? '';
  check(`plain duo ticket shows the promo price (${duoPrice})`, label.includes(duoPrice.toLocaleString('es-CO')), label);

  // E2: duo promo sharing the order with a more expensive full-price item.
  m = currentMarker();
  const duoPlusXl = await place(dineIn([
    pizza('personal', [{ flavor: 'margherita', portion: 100 }], { promoItem: true }),
    product('pastas', 'alfredo', { promoItem: true }),
    pizza('xlarge', [{ flavor: 'pepperoni', portion: 100 }]),   // 86.000, full price, NOT part of the promo
  ], { promoType: 'duo' }));
  await sleep(500);
  label = jobsSince(m)[0].text.split('\n').find((l) => l.includes('PROMO')) ?? '';
  check('duo label shows the promo price, not the pricier extra item sharing the order',
    label.includes(duoPrice.toLocaleString('es-CO')),
    `order ${duoPlusXl.id} (total ${duoPlusXl.total}) printed "${label.trim()}", expected ${duoPrice.toLocaleString('es-CO')}`);

  // E3: pizza_xl promo where an extra, non-promo pizza was added to the cart first.
  m = currentMarker();
  const xlAfterExtra = await place(dineIn([
    pizza('small', [{ flavor: 'margherita', portion: 100 }]),    // extra pizza, added FIRST, 34.000
    pizza('xlarge', [{ flavor: 'margherita', portion: 100 }], { promoItem: true }),
    product('drinks', 'soft_drink_1_5l', { drinkFlavor: 'uva', promoItem: true }),
    product('appetizers', 'garlic_bread', { promoItem: true }),
  ], { promoType: 'pizza_xl' }));
  await sleep(500);
  label = jobsSince(m)[0].text.split('\n').find((l) => l.includes('PROMO')) ?? '';
  check('pizza_xl label shows the promo price even when an extra pizza is listed first',
    label.includes(xlPrice.toLocaleString('es-CO')),
    `order ${xlAfterExtra.id} (total ${xlAfterExtra.total}) printed "${label.trim()}", expected ${xlPrice.toLocaleString('es-CO')}`);

  // The label now reads a persisted flag rather than guessing from prices, so
  // check the flag itself is recorded and exposed correctly.
  const xlOrder = (await client.get(`/api/orders/${xlAfterExtra.id}`)).body;
  eq('exactly the three promo items are flagged', xlOrder.items.filter((i: any) => i.promoItem).length, 3);
  check('the extra full-price pizza is not flagged',
    xlOrder.items.find((i: any) => i.unitPrice === 34000)?.promoItem === false,
    JSON.stringify(xlOrder.items.map((i: any) => [i.unitPrice, i.promoItem])));
  const plainOrder = (await client.get(`/api/orders/${o1.id}`)).body;
  check('an order with no promo flags nothing', plainOrder.items.every((i: any) => i.promoItem === false));

  // -------------------------------------------------------------------------
  section('F. Delivery: comanda copy + bill at settlement');
  const cust = (await client.get('/api/customers/search?q=Cliente')).body[0];
  const del = await place({ orderType: 'delivery', employeeId: emp, customerId: cust.id, customerAddressId: cust.addresses[0].id,
    items: [pizza('medium', [{ flavor: 'margherita', portion: 100 }])] });
  m = currentMarker();
  const paid = await client.post(`/api/orders/${del.id}/complete`, {
    payments: [{ method: 'cash', grossAmount: del.total + 6000 + 3000, tipAmount: 3000, deliveryFee: 6000 }],
  });
  check('delivery settles', paid.status === 200, JSON.stringify(paid.body).slice(0, 200));
  await sleep(2500);
  jobs = jobsSince(m);
  const counterJobs = jobs.filter((j) => j.queue === 'counter_printer');
  check('settling a delivery emits both a comanda copy and a bill on the counter printer', counterJobs.length === 2,
    `${counterJobs.length}: ${jobs.map((j) => j.file + '/' + j.queue).join(', ')}`);
  check('the comanda copy prints BEFORE the slow rasterized bill',
    counterJobs.length === 2 && counterJobs[0].text.includes('COMANDA') && counterJobs[1].text.includes('<RASTER'),
    counterJobs.map((j) => j.text.slice(0, 40)).join(' | '));
  check('nothing was sent back to the kitchen printer at settlement',
    jobs.every((j) => j.queue !== 'kitchen_printer'), jobs.map((j) => j.queue).join(','));

  section('G. Bill arithmetic');
  const billHtmlPath = path.join(PRINTOUTS, `order-${del.id}-bill.html`);
  check('the bill HTML was captured', fs.existsSync(billHtmlPath));
  const html = fs.readFileSync(billHtmlPath, 'utf8');
  const money = (label: string) => {
    const re = new RegExp(`<span>${label}</span><span>\\$?([\\d.,-]+)</span>`);
    const mm = html.match(re);
    return mm ? Number(mm[1].replace(/[^0-9-]/g, '')) : null;
  };
  const settled = (await client.get(`/api/orders/${del.id}`)).body;
  eq('bill Subtotal = order.total', money('Subtotal'), settled.total);
  eq('bill Domicilio = delivery fee', money('Domicilio'), settled.deliveryFee);
  eq('bill Propina = tip', money('Propina'), settled.tip);
  eq('bill TOTAL = subtotal + fee + tip - discount', money('TOTAL'), settled.total + settled.deliveryFee + settled.tip - settled.discount);
  const payMatch = html.match(/<span>Pago \(([^)]+)\)<\/span><span>\$([\d.,]+)<\/span>/g) ?? [];
  const paySum = payMatch.map((s) => Number((s.match(/\$([\d.,]+)/) as RegExpMatchArray)[1].replace(/[^0-9]/g, ''))).reduce((a, b) => a + b, 0);
  eq('bill payment lines sum to the amount actually collected', paySum, settled.grandTotal - settled.discount);
  const itemTotals = [...html.matchAll(/<td class="num">\$([\d.,]+)<\/td>\s*<\/tr>/g)].map((x) => Number(x[1].replace(/[^0-9]/g, '')));
  eq('bill line totals sum to the subtotal', itemTotals.reduce((a, b) => a + b, 0), settled.total);

  section('H. Bill for a discounted order');
  const disc = await place(dineIn([pizza('large', [{ flavor: 'margherita', portion: 100 }])]));
  await client.post(`/api/orders/${disc.id}/complete`, { payments: [{ method: 'card', grossAmount: disc.total, discount: 6000 }] });
  // Dine-in no longer auto-prints a bill at completion (see H3 below) - print
  // the final invoice explicitly so the rest of this section/H2 can exercise
  // the exact same arithmetic checks as before against a real saved file.
  await client.post(`/api/orders/${disc.id}/invoice`, {});
  await sleep(2500);
  const discHtml = fs.readFileSync(path.join(PRINTOUTS, `order-${disc.id}-bill.html`), 'utf8');
  const discOrder = (await client.get(`/api/orders/${disc.id}`)).body;
  const dmoney = (label: string) => {
    const mm = discHtml.match(new RegExp(`<span>${label}</span><span>-?\\$?([\\d.,-]+)</span>`));
    return mm ? Number(mm[1].replace(/[^0-9-]/g, '')) : null;
  };
  eq('discounted bill Subtotal is the pre-discount figure', dmoney('Subtotal'), discOrder.total);
  eq('discounted bill shows the discount', dmoney('Descuento'), 6000);
  eq('discounted bill TOTAL is what the customer pays', dmoney('TOTAL'), discOrder.total - 6000);

  section('H2. Correcting the payments refreshes the saved bill');
  {
    // The saved copy is what a reprint re-sends, so it has to follow a
    // correction - otherwise the reprinted bill still names the old method.
    const before = fs.readFileSync(path.join(PRINTOUTS, `order-${disc.id}-bill.html`), 'utf8');
    check('the original bill names the card', before.includes('Tarjeta'), before.slice(0, 200));
    const marker = currentMarker();
    const corrected = await client.put(`/api/orders/${disc.id}/payments`, {
      payments: [{ method: 'cash', grossAmount: discOrder.total, discount: 6000 }],
    });
    check('the correction succeeds', corrected.status === 200, JSON.stringify(corrected.body).slice(0, 200));
    const saved = await client.post(`/api/orders/${disc.id}/reprint`, { kind: 'bill' });
    check('the corrected bill can be reprinted', saved.status === 200, JSON.stringify(saved.body));
    await sleep(2500);
    const after = fs.readFileSync(path.join(PRINTOUTS, `order-${disc.id}-bill.html`), 'utf8');
    check('the saved bill now names the corrected method', after.includes('Efectivo'), after.slice(after.indexOf('Pago'), after.indexOf('Pago') + 200));
    check('and no longer names the old one', !after.includes('Pago (Tarjeta)'), after.slice(after.indexOf('Pago'), after.indexOf('Pago') + 200));
    check('correcting a payment prints nothing by itself',
      jobsSince(marker).filter((j) => j.text.includes('<RASTER')).length === 1,
      'exactly one raster job expected, from the explicit reprint above');
  }

  section('H3. Dine-in manual invoice: preview, invalidation, and the final print');
  {
    const dinein = await place(dineIn([pizza('large', [{ flavor: 'margherita', portion: 100 }])]));
    const fresh = (await client.get(`/api/orders/${dinein.id}`)).body;
    eq('a fresh dine-in order has no bill yet', fresh.hasBill, false);

    const preview = await client.post(`/api/orders/${dinein.id}/invoice`, { tip: 5000 });
    check('the preview call succeeds', preview.status === 200, JSON.stringify(preview.body).slice(0, 200));
    eq('hasBill flips true once the preview is printed', preview.body.hasBill, true);
    await sleep(2500);
    const previewHtml = fs.readFileSync(path.join(PRINTOUTS, `order-${dinein.id}-bill.html`), 'utf8');
    check('the preview has no payment-method line (nothing has been paid yet)', !previewHtml.includes('Pago ('), previewHtml.slice(previewHtml.indexOf('TOTAL')));
    check('the preview reflects the staged tip', previewHtml.includes('<span>Propina</span><span>$5.000</span>'), previewHtml);

    const completeStart = currentMarker();
    await client.post(`/api/orders/${dinein.id}/complete`, { payments: [{ method: 'card', grossAmount: dinein.total }] });
    await sleep(600);
    eq('completing a dine-in order does not auto-print a bill',
      jobsSince(completeStart).filter((j) => j.text.includes('<RASTER')).length, 0);
    const preFinal = (await client.get(`/api/orders/${dinein.id}`)).body;
    check('the stale pre-payment preview is still the saved copy right after completion', preFinal.hasBill, JSON.stringify(preFinal.hasBill));

    const notForced = await client.post(`/api/orders/${dinein.id}/invoice`, {});
    await sleep(2500);
    const resent = fs.readFileSync(path.join(PRINTOUTS, `order-${dinein.id}-bill.html`), 'utf8');
    check('without force, printing again just resends the stale saved preview (no payment line yet)',
      notForced.status === 200 && !resent.includes('Pago ('), JSON.stringify(notForced.status));

    const final = await client.post(`/api/orders/${dinein.id}/invoice`, { force: true });
    check('force:true regenerates even though something was already saved', final.status === 200, JSON.stringify(final.body).slice(0, 200));
    await sleep(2500);
    const finalHtml = fs.readFileSync(path.join(PRINTOUTS, `order-${dinein.id}-bill.html`), 'utf8');
    check('the forced final invoice includes the real payment method', finalHtml.includes('Pago (Tarjeta)'), finalHtml.slice(finalHtml.indexOf('TOTAL')));

    // Invalidation: adding an item to a still-open dine-in order clears its saved preview.
    const openOrder = await place(dineIn([pizza('personal', [{ flavor: 'margherita', portion: 100 }])]));
    await client.post(`/api/orders/${openOrder.id}/invoice`, {});
    await sleep(2500);
    const beforeAdd = (await client.get(`/api/orders/${openOrder.id}`)).body;
    eq('the open order has a saved preview before more items are added', beforeAdd.hasBill, true);
    await client.post(`/api/orders/${openOrder.id}/items`, { items: [product('drinks', 'soft_drink', { drinkFlavor: 'agua' })] });
    await waitForStatus(client, openOrder.id, 'ACTIVE');
    const afterAdd = (await client.get(`/api/orders/${openOrder.id}`)).body;
    eq('adding an item invalidates the saved preview (hasBill reverts false)', afterAdd.hasBill, false);

    // A still-open order can't get the final (payment-bearing) invoice.
    const tooEarly = await client.post(`/api/orders/${openOrder.id}/invoice`, { force: true });
    check('force:true on a still-open order still renders a preview, not an error', tooEarly.status === 200, JSON.stringify(tooEarly.status));
  }

  section('I. Reprint guards');
  const noBill = await client.post(`/api/orders/${o1.id}/reprint`, { kind: 'bill' });
  check('reprinting a bill that was never generated 404s', noBill.status === 404, `${noBill.status} ${JSON.stringify(noBill.body)}`);
  const badKind = await client.post(`/api/orders/${o1.id}/reprint`, { kind: 'poster' });
  check('an unknown reprint kind is rejected', badKind.status >= 400, `${badKind.status}`);
  const noOrder = await client.post(`/api/orders/999999/reprint`, { kind: 'bill' });
  check('reprinting a nonexistent order 404s', noOrder.status === 404, `${noOrder.status}`);

  section('I2. The delivery number of the day is stable');
  {
    // Numbered live, deleting an earlier delivery order renumbered every later
    // one, so a reprint stopped matching the ticket the kitchen was holding.
    const cust2 = (await client.get('/api/customers/search?q=Cliente')).body[0];
    const makeDelivery = () => place({
      orderType: 'delivery', employeeId: emp, customerId: cust2.id, customerAddressId: cust2.addresses[0].id,
      items: [product('appetizers', 'garlic_bread')],
    });
    const first = await makeDelivery();
    const second = await makeDelivery();
    await sleep(600);

    const numberOn = async (orderId: number) => {
      const marker = currentMarker();
      await client.post(`/api/orders/${orderId}/reprint`, { kind: 'kitchen_ticket' });
      await sleep(400);
      const line = jobsSince(marker)[0].text.split('\n').find((l) => l.includes('Domicilio #')) ?? '';
      return line.replace(/\D/g, '');
    };
    const secondNumberBefore = await numberOn(second.id);
    check('a delivery ticket carries a day number', secondNumberBefore !== '', secondNumberBefore);

    const del = await client.del(`/api/orders/${first.id}`);
    check('the earlier delivery order can be deleted', del.status === 200, JSON.stringify(del.body));
    const secondNumberAfter = await numberOn(second.id);
    eq('deleting an earlier delivery order does not renumber a later one', secondNumberAfter, secondNumberBefore);
  }

  section('J. Injection safety on printed text');
  const evil = (await client.post('/api/customers', { name: 'Ana@V Perez', phone: '3001111111' })).body;
  m = currentMarker();
  await place({ orderType: 'takeaway', employeeId: emp, customerId: evil.id, items: [product('appetizers', 'garlic_bread')] });
  await sleep(500);
  const evilTicket = jobsSince(m)[0];
  const raw = fs.readFileSync(path.join(PRINTOUTS, evilTicket.file.replace('.txt', '.bin')));
  // The only ESC/POS control bytes in the payload must be the ones we emitted
  // ourselves; a customer name must not be able to inject a cut or a reset.
  const nameStart = raw.indexOf(Buffer.from('Cliente', 'latin1'));
  const nameLine = raw.subarray(nameStart, nameStart + 40).toString('latin1');
  check('control bytes in a customer name are stripped before printing',
    !/[\x00-\x09\x0B-\x1F\x7F]/.test(nameLine), JSON.stringify(nameLine));
  check('the injected name still prints its readable characters', nameLine.includes('Ana') && nameLine.includes('Perez'), nameLine);

  term.close();
  summary();
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
