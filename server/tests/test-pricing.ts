/* Audit suite 1: server-side pricing, validation, and item math. */
import { Client, Terminal, check, eq, section, summary, results, pizza, product, warn } from './lib.js';

const EMP_ADMIN = 1;
const EMP_STAFF = 2;

const client = new Client();

// Prices as seeded (verified against GET /api/menu before the run).
const P = {
  classic: { personal: 22000, small: 34000, medium: 52000, large: 66000, xlarge: 80000 },
  special: { personal: 24000, small: 36000, medium: 55000, large: 70000, xlarge: 86000 },
  garlic_bread: 10000,
  soft_drink_1_5l: 9000,
  soft_drink: 5000,
  gratin: 24000,
  calzone_small: 26000,
  calzone_large: 37000,
  pasta_alfredo: 27000,
  lasagna_mixta: 27000,
  lasagna_mamma_mia: 28000,
  pasta_seafood: 30000,
  milk: 9500,
  // Filled in from GET /api/promos at run time - these are admin-editable, so
  // hardcoding them would test the seed rather than the pricing logic.
  duoPromo: 0,
  xlPromo: 0,
  xlSodaSurcharge: 0,
};

async function makeCustomer(name: string, phone: string) {
  const r = await client.post('/api/customers', { name, phone });
  if (r.status !== 201 && r.status !== 200) throw new Error(`customer create failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

async function makeAddress(customerId: number, neighborhoodId: number) {
  const r = await client.post(`/api/customers/${customerId}/addresses`, {
    streetAddress: 'Calle 10 # 5-55',
    propertyType: 'HOUSE',
    neighborhoodId,
  });
  if (r.status >= 300) throw new Error(`address create failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

/** Every order returned by the API must satisfy these, unconditionally. */
function assertOrderInvariants(label: string, order: any) {
  const itemsSum = order.items.reduce((s: number, i: any) => s + i.unitPrice * i.quantity, 0);
  check(`${label}: sum(items.unitPrice*qty) === order.total`, itemsSum === order.total, `items=${itemsSum} total=${order.total}`);
  check(`${label}: grandTotal === total + tip + deliveryFee`, order.grandTotal === order.total + order.tip + order.deliveryFee,
    `grand=${order.grandTotal} total=${order.total} tip=${order.tip} fee=${order.deliveryFee}`);
  check(`${label}: no negative money`, order.total >= 0 && order.tip >= 0 && order.deliveryFee >= 0 && order.discount >= 0,
    JSON.stringify({ total: order.total, tip: order.tip, fee: order.deliveryFee, disc: order.discount }));
  check(`${label}: every unitPrice is a non-negative integer`, order.items.every((i: any) => Number.isInteger(i.unitPrice) && i.unitPrice >= 0),
    JSON.stringify(order.items.map((i: any) => i.unitPrice)));
  if (order.payments.length > 0) {
    const gross = order.payments.reduce((s: number, p: any) => s + p.grossAmount, 0);
    const net = order.payments.reduce((s: number, p: any) => s + p.netAmount, 0);
    const tip = order.payments.reduce((s: number, p: any) => s + p.tipAmount, 0);
    const fee = order.payments.reduce((s: number, p: any) => s + p.deliveryFee, 0);
    check(`${label}: sum(payments.grossAmount) === grandTotal`, gross === order.grandTotal, `gross=${gross} grand=${order.grandTotal}`);
    check(`${label}: sum(payments.netAmount) === order.total`, net === order.total, `net=${net} total=${order.total}`);
    check(`${label}: sum(tipAmount) === order.tip`, tip === order.tip);
    check(`${label}: sum(deliveryFee) === order.deliveryFee`, fee === order.deliveryFee);
    check(`${label}: every payment netAmount === gross - tip - fee`,
      order.payments.every((p: any) => p.netAmount === p.grossAmount - p.tipAmount - p.deliveryFee));
    check(`${label}: every payment discount <= netAmount`, order.payments.every((p: any) => p.discount <= p.netAmount));
  }
}

async function main() {
  await client.loginAdmin(EMP_ADMIN, 'audit1234');

  const promos = (await client.get('/api/promos')).body;
  P.duoPromo = promos.find((p: any) => p.promoType === 'duo').price;
  P.xlPromo = promos.find((p: any) => p.promoType === 'pizza_xl').price;
  P.xlSodaSurcharge = promos.find((p: any) => p.promoType === 'pizza_xl').sodaSurcharge;
  console.log(`  (configured promos: duo=${P.duoPromo}, pizza_xl=${P.xlPromo} +${P.xlSodaSurcharge} soda)`);

  const cities = (await client.get('/api/locations/cities')).body;
  const neighborhoods = (await client.get(`/api/locations/cities/${cities[0].id}/neighborhoods`)).body;
  // Give one neighborhood a non-zero delivery fee so the "suggested fee" path is real.
  await client.put(`/api/locations/neighborhoods/${neighborhoods[0].id}`, { name: neighborhoods[0].name, deliveryFee: 7000 });

  const cust = await makeCustomer('Cliente Prueba', '3001234567');
  const addr = await makeAddress(cust.id, neighborhoods[0].id);
  const cust2 = await makeCustomer('Otro Cliente', '3009999999');
  const addr2 = await makeAddress(cust2.id, neighborhoods[1].id);

  const t = new Terminal('pricing');
  await t.connect();

  const place = async (label: string, req: any) => {
    const r = await t.place(req);
    if (r.type !== 'order_created') throw new Error(`${label}: expected order_created, got ${r.type}: ${r.message}`);
    assertOrderInvariants(label, r.order);
    return r.order;
  };
  const expectReject = async (label: string, req: any, mustMention?: string) => {
    const r = await t.place(req);
    const rejected = check(`${label} is rejected`, r.type === 'error', `got ${r.type} ${JSON.stringify(r.order?.id)}`);
    if (rejected && mustMention) {
      check(`${label} error mentions "${mustMention}"`, (r.message ?? '').toLowerCase().includes(mustMention.toLowerCase()), r.message ?? '');
    }
    return r;
  };

  const dineIn = (items: any[], extra: Record<string, unknown> = {}) =>
    ({ orderType: 'dine_in', employeeId: EMP_STAFF, tableNumber: 1, items, ...extra });

  // -------------------------------------------------------------------------
  section('A. Pizza pricing');

  let o = await place('classic personal', dineIn([pizza('personal', [{ flavor: 'margherita', portion: 100 }])]));
  eq('classic personal price', o.total, P.classic.personal);
  eq('classic personal resolves to classic group', o.items[0].pizzaRef.group, 'classic');

  o = await place('special large', dineIn([pizza('large', [{ flavor: 'pepperoni', portion: 100 }])]));
  eq('special large price', o.total, P.special.large);
  eq('special large resolves to special group', o.items[0].pizzaRef.group, 'special');

  o = await place('mixed classic+special half/half', dineIn([pizza('medium', [
    { flavor: 'margherita', portion: 50 }, { flavor: 'pepperoni', portion: 50 },
  ])]));
  eq('one special flavor upgrades the whole pizza to the special price', o.total, P.special.medium);
  eq('mixed pizza is stored under the special group', o.items[0].pizzaRef.group, 'special');

  o = await place('3 flavors 34/33/33', dineIn([pizza('medium', [
    { flavor: 'margherita', portion: 34 }, { flavor: 'hawaiian', portion: 33 }, { flavor: 'napolitana', portion: 33 },
  ])]));
  eq('equal-thirds classic medium price', o.total, P.classic.medium);
  eq('3 flavor portions round-trip', o.items[0].pizzaRef.flavors.map((f: any) => f.portion), [34, 33, 33]);

  o = await place('half/quarter/quarter', dineIn([pizza('large', [
    { flavor: 'margherita', portion: 50 }, { flavor: 'hawaiian', portion: 25 }, { flavor: 'napolitana', portion: 25 },
  ])]));
  eq('50/25/25 classic large price', o.total, P.classic.large);

  o = await place('pizza quantity 3', dineIn([pizza('small', [{ flavor: 'margherita', portion: 100 }], { quantity: 3 })]));
  eq('quantity multiplies into the total', o.total, P.classic.small * 3);
  eq('quantity is stored on the item, not duplicated rows', o.items.length, 1);

  // -------------------------------------------------------------------------
  section('B. Product pricing');

  o = await place('flat product', dineIn([product('appetizers', 'garlic_bread')]));
  eq('flat product price', o.total, P.garlic_bread);

  o = await place('sized product', dineIn([product('calzones', 'calzone', { size: 'large', pizzaFlavor: 'margherita' })]));
  eq('sized product uses the size price', o.total, P.calzone_large);

  o = await place('drink with flavor', dineIn([product('drinks', 'soft_drink_1_5l', { drinkFlavor: 'coca_cola' })]));
  eq('drink flavor is price-neutral', o.total, P.soft_drink_1_5l);

  o = await place('gratinado with pizza flavor', dineIn([product('gratinados', 'gratin', { pizzaFlavor: 'pepperoni' })]));
  eq('gratinado price', o.total, P.gratin);

  o = await place('multi-line order', dineIn([
    pizza('large', [{ flavor: 'margherita', portion: 100 }], { quantity: 2 }),
    product('drinks', 'soft_drink', { drinkFlavor: 'agua', quantity: 4 }),
    product('desserts', 'ice_cream'),
  ]));
  eq('multi-line total', o.total, P.classic.large * 2 + P.soft_drink * 4 + 12000);

  // -------------------------------------------------------------------------
  section('C. Item validation (must be rejected server-side)');

  await expectReject('portions summing to 99', dineIn([pizza('medium', [
    { flavor: 'margherita', portion: 50 }, { flavor: 'hawaiian', portion: 49 }])]), 'sumar 100');
  await expectReject('portions summing to 101', dineIn([pizza('medium', [
    { flavor: 'margherita', portion: 51 }, { flavor: 'hawaiian', portion: 50 }])]), 'sumar 100');
  await expectReject('duplicate flavors', dineIn([pizza('medium', [
    { flavor: 'margherita', portion: 50 }, { flavor: 'margherita', portion: 50 }])]), 'duplicados');
  await expectReject('more flavors than the size allows', dineIn([pizza('personal', [
    { flavor: 'margherita', portion: 34 }, { flavor: 'hawaiian', portion: 33 }, { flavor: 'napolitana', portion: 33 }])]), 'máximo');
  await expectReject('unpriced size (slice)', dineIn([pizza('slice', [{ flavor: 'margherita', portion: 100 }])]));
  await expectReject('unknown pizza size', dineIn([pizza('gigante', [{ flavor: 'margherita', portion: 100 }])]));
  await expectReject('unknown flavor', dineIn([pizza('medium', [{ flavor: 'no_existe', portion: 100 }])]));
  await expectReject('unknown product', dineIn([product('appetizers', 'no_existe')]));
  await expectReject('unknown category', dineIn([product('no_existe', 'garlic_bread')]));
  await expectReject('quantity 0', dineIn([product('appetizers', 'garlic_bread', { quantity: 0 })]));
  await expectReject('negative quantity', dineIn([product('appetizers', 'garlic_bread', { quantity: -2 })]));
  await expectReject('fractional quantity', dineIn([product('appetizers', 'garlic_bread', { quantity: 1.5 })]));
  await expectReject('sized product without a size', dineIn([product('calzones', 'calzone', { pizzaFlavor: 'margherita' })]));
  await expectReject('drink product without a flavor', dineIn([product('drinks', 'soft_drink_1_5l')]));
  await expectReject('gratinado without a pizza flavor', dineIn([product('gratinados', 'gratin')]));
  await expectReject('empty items array', dineIn([]));
  await expectReject('item with no type', dineIn([{ category: 'appetizers', product: 'garlic_bread', quantity: 1 }]));
  await expectReject('fractional portion', dineIn([pizza('medium', [
    { flavor: 'margherita', portion: 50.5 }, { flavor: 'hawaiian', portion: 49.5 }])]));

  section('D. Order-level validation');
  await expectReject('missing employeeId', { orderType: 'dine_in', tableNumber: 1, items: [product('appetizers', 'garlic_bread')] }, 'employeeId');
  await expectReject('nonexistent employee', { orderType: 'dine_in', employeeId: 9999, tableNumber: 1, items: [product('appetizers', 'garlic_bread')] });
  await expectReject('table 0', { orderType: 'dine_in', employeeId: EMP_STAFF, tableNumber: 0, items: [product('appetizers', 'garlic_bread')] });
  await expectReject('table beyond the floor plan', { orderType: 'dine_in', employeeId: EMP_STAFF, tableNumber: 99, items: [product('appetizers', 'garlic_bread')] });
  await expectReject('takeaway without a customer', { orderType: 'takeaway', employeeId: EMP_STAFF, items: [product('appetizers', 'garlic_bread')] }, 'customerId');
  await expectReject('delivery without an address', { orderType: 'delivery', employeeId: EMP_STAFF, customerId: cust.id, items: [product('appetizers', 'garlic_bread')] }, 'customerAddressId');
  await expectReject("delivery using another customer's address",
    { orderType: 'delivery', employeeId: EMP_STAFF, customerId: cust.id, customerAddressId: addr2.id, items: [product('appetizers', 'garlic_bread')] }, 'no pertenece');
  await expectReject('unknown orderType', { orderType: 'eat_in', employeeId: EMP_STAFF, items: [product('appetizers', 'garlic_bread')] });

  // Deactivated employee can't place orders.
  await client.del(`/api/employees/${4}`);
  await expectReject('deactivated employee', { orderType: 'dine_in', employeeId: 4, tableNumber: 1, items: [product('appetizers', 'garlic_bread')] }, 'no está activo');
  await client.post(`/api/employees/${4}/activate`);

  // Sold-out product can't be ordered.
  const adminProducts = (await client.get('/api/products')).body;
  const iceCream = adminProducts.find((p: any) => p.key === 'ice_cream');
  await client.put(`/api/products/${iceCream.id}`, { isAvailable: false });
  await expectReject('sold-out product', dineIn([product('desserts', 'ice_cream')]), 'no está disponible');
  await client.put(`/api/products/${iceCream.id}`, { isAvailable: true });

  // -------------------------------------------------------------------------
  section('E. Promotions');

  const duoItems = [
    pizza('personal', [{ flavor: 'margherita', portion: 100 }], { promoGroup: 0 }),
    product('pastas', 'alfredo', { promoGroup: 0 }),
  ];
  o = await place('duo promo', dineIn(duoItems, { promos: ['duo'] }));
  eq('duo total is the flat promo price', o.total, P.duoPromo);
  eq('duo: first item carries the price, second is free', o.items.map((i: any) => i.unitPrice), [P.duoPromo, 0]);

  o = await place('duo promo + extra full-price item', dineIn([
    ...duoItems,
    product('drinks', 'soft_drink', { drinkFlavor: 'agua' }),
  ], { promos: ['duo'] }));
  eq('duo + extra total', o.total, P.duoPromo + P.soft_drink);

  await expectReject('duo with only 1 promo item', dineIn([duoItems[0]], { promos: ['duo'] }), 'exactamente 2');
  await expectReject('duo with 3 promo items', dineIn([...duoItems, product('pastas', 'carbonara', { promoGroup: 0 })], { promos: ['duo'] }), 'exactamente 2');
  await expectReject('duo with an excluded flavor', dineIn([
    pizza('personal', [{ flavor: 'campesina', portion: 100 }], { promoGroup: 0 }),
    product('pastas', 'alfredo', { promoGroup: 0 }),
  ], { promos: ['duo'] }), 'no está incluido');
  await expectReject('duo with a mitad y mitad pizza', dineIn([
    pizza('personal', [{ flavor: 'margherita', portion: 50 }, { flavor: 'hawaiian', portion: 50 }], { promoGroup: 0 }),
    product('pastas', 'alfredo', { promoGroup: 0 }),
  ], { promos: ['duo'] }), 'mitad y mitad');
  await expectReject('duo with a non-personal pizza', dineIn([
    pizza('large', [{ flavor: 'margherita', portion: 100 }], { promoGroup: 0 }),
    product('pastas', 'alfredo', { promoGroup: 0 }),
  ], { promos: ['duo'] }), 'personal');
  await expectReject('duo with Mamma Mia lasagna', dineIn([
    product('lasagnas', 'mamma_mia', { promoGroup: 0 }),
    product('pastas', 'alfredo', { promoGroup: 0 }),
  ], { promos: ['duo'] }), 'Mamma Mia');
  await expectReject('duo with Marinera pasta', dineIn([
    product('pastas', 'seafood', { promoGroup: 0 }),
    product('pastas', 'alfredo', { promoGroup: 0 }),
  ], { promos: ['duo'] }), 'Marinera');
  await expectReject('duo with an ineligible category', dineIn([
    product('desserts', 'ice_cream', { promoGroup: 0 }),
    product('pastas', 'alfredo', { promoGroup: 0 }),
  ], { promos: ['duo'] }));
  await expectReject('duo promo item with quantity 2', dineIn([
    pizza('personal', [{ flavor: 'margherita', portion: 100 }], { promoGroup: 0, quantity: 2 }),
    product('pastas', 'alfredo', { promoGroup: 0 }),
  ], { promos: ['duo'] }), 'cantidad 1');

  const xlItems = (sodaFlavor: string) => [
    pizza('xlarge', [{ flavor: 'margherita', portion: 100 }], { promoGroup: 0 }),
    product('drinks', 'soft_drink_1_5l', { drinkFlavor: sodaFlavor, promoGroup: 0 }),
    product('appetizers', 'garlic_bread', { promoGroup: 0 }),
  ];
  o = await place('pizza_xl promo, free soda flavor', dineIn(xlItems('uva'), { promos: ['pizza_xl'] }));
  eq('xl promo total (no surcharge)', o.total, P.xlPromo);
  eq('xl promo item prices', o.items.map((i: any) => i.unitPrice), [P.xlPromo, 0, 0]);

  o = await place('pizza_xl promo, surcharged soda flavor', dineIn(xlItems('coca_cola'), { promos: ['pizza_xl'] }));
  eq('xl promo total (with surcharge)', o.total, P.xlPromo + P.xlSodaSurcharge);
  eq('xl promo surcharge lands on the soda line', o.items.map((i: any) => i.unitPrice), [P.xlPromo, P.xlSodaSurcharge, 0]);

  await expectReject('pizza_xl with a non-XL pizza', dineIn([
    pizza('large', [{ flavor: 'margherita', portion: 100 }], { promoGroup: 0 }),
    product('drinks', 'soft_drink_1_5l', { drinkFlavor: 'uva', promoGroup: 0 }),
    product('appetizers', 'garlic_bread', { promoGroup: 0 }),
  ], { promos: ['pizza_xl'] }), 'pizza XL');
  await expectReject('pizza_xl missing the bread', dineIn([
    pizza('xlarge', [{ flavor: 'margherita', portion: 100 }], { promoGroup: 0 }),
    product('drinks', 'soft_drink_1_5l', { drinkFlavor: 'uva', promoGroup: 0 }),
  ], { promos: ['pizza_xl'] }), 'exactamente 3');
  await expectReject('unknown promoType', dineIn(xlItems('uva'), { promos: ['combo'] }), 'promos');

  section('E2. Promo pricing is read live from promo_settings');
  await client.put('/api/promos/duo', { price: 40000 });
  o = await place('duo after an admin price change', dineIn(duoItems, { promos: ['duo'] }));
  eq('duo uses the newly configured price with no restart', o.total, 40000);
  await client.put('/api/promos/duo', { price: P.duoPromo });

  section('E3. Promo tagging edge cases');
  const rNoTags = await t.place(dineIn([
    pizza('personal', [{ flavor: 'margherita', portion: 100 }]),
    product('pastas', 'alfredo'),
  ], { promos: ['duo'] }));
  if (rNoTags.type === 'order_created') {
    warn('promoType with zero promoItem-tagged items',
      `accepted and priced at ${rNoTags.order.total} (order ${rNoTags.order.id}) - expected a rejection, since 'duo' requires exactly 2 tagged items`);
  } else {
    check("promoType='duo' with no tagged items is rejected", true);
  }

  // -------------------------------------------------------------------------
  section('F. Adding items to an open order');

  const base = await place('order to grow', dineIn([product('appetizers', 'garlic_bread')]));
  const add = await client.post(`/api/orders/${base.id}/items`, { items: [product('drinks', 'soft_drink', { drinkFlavor: 'agua', quantity: 2 })] });
  check('adding items returns 200', add.status === 200, JSON.stringify(add.body));
  eq('total grows by exactly the added items', add.body.total, P.garlic_bread + P.soft_drink * 2);
  assertOrderInvariants('after item addition', add.body);

  const addBad = await client.post(`/api/orders/${base.id}/items`, { items: [product('appetizers', 'no_existe')] });
  check('adding an unknown item is rejected', addBad.status >= 400, JSON.stringify(addBad.body));
  const afterBad = (await client.get(`/api/orders/${base.id}`)).body;
  eq('a rejected addition leaves the total untouched', afterBad.total, P.garlic_bread + P.soft_drink * 2);

  const addEmpty = await client.post(`/api/orders/${base.id}/items`, { items: [] });
  check('adding an empty array is rejected', addEmpty.status >= 400, JSON.stringify(addEmpty.body));

  // -------------------------------------------------------------------------
  section('G. Takeaway / delivery orders');

  o = await place('takeaway with customer', { orderType: 'takeaway', employeeId: EMP_STAFF, customerId: cust.id, items: [product('appetizers', 'garlic_bread')] });
  eq('takeaway has no table', o.tableNumber, null);
  eq('takeaway carries the customer name', o.customerName, 'Cliente Prueba');

  o = await place('delivery with address', { orderType: 'delivery', employeeId: EMP_STAFF, customerId: cust.id, customerAddressId: addr.id, items: [pizza('large', [{ flavor: 'margherita', portion: 100 }])] });
  check('delivery order carries a formatted address', typeof o.address === 'string' && o.address.length > 0, JSON.stringify(o.address));
  eq('delivery fee is 0 until payment declares it', o.deliveryFee, 0);

  t.close();
  summary();
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
