/**
 * The cart's price preview (src/lib/pricing.ts) and promo preview
 * (src/lib/promos.ts), checked against the rules server/src/services/
 * orderService.ts enforces. The preview is allowed to be a preview - but when
 * it shows a number, that number has to be the one the customer gets charged,
 * otherwise the cart total and the bill disagree.
 */
import { suite, check, eq, summary, resetResults, isEntrypoint } from './harness.js';
import {
  resolvePizzaGroupId,
  pizzaUnitPrice,
  pizzaFlavorExtraCost,
  productUnitPrice,
  computeFlavorPortions,
  splitPatternsFor,
  formatPortionFraction,
  orderablePizzaSizes,
  allPizzaFlavors,
  maxFlavorsFor,
  groupOrderItems,
} from '../src/lib/pricing.js';
import {
  applyPromoPricingPreview,
  isPizzaEligibleForDuo,
  isProductEligibleForPromo,
  eligibleProductsForPromo,
  PROMO_ITEM_COUNTS,
  DUO_EXCLUDED_FLAVORS,
  XL_SODA_SURCHARGE_FLAVORS,
} from '../src/lib/promos.js';
import type { Menu, PizzaCategory } from '../src/types/api.js';

// Mirrors the seeded menu (server/src/db/seed.ts + migrate.ts).
const pizzas: PizzaCategory = {
  id: 'pizzas',
  name: 'Pizzas',
  groups: [
    {
      id: 'classic',
      name: 'Clásicas',
      sizes: [
        { id: 'slice', name: 'Slice', slices: 1, maxFlavors: 1 },
        { id: 'personal', name: 'Personal', slices: 6, maxFlavors: 2, price: 22000 },
        { id: 'small', name: 'Pequeña', slices: 8, maxFlavors: 2, price: 34000 },
        { id: 'medium', name: 'Mediana', slices: 10, maxFlavors: 3, price: 52000 },
        { id: 'large', name: 'Grande', slices: 12, maxFlavors: 4, price: 66000 },
        { id: 'xlarge', name: 'XL', slices: 14, maxFlavors: 4, price: 80000 },
      ],
      flavors: [
        { id: 'margherita', name: 'Margarita', description: '', isAvailable: true, extraCost: 0 },
        { id: 'hawaiian', name: 'Hawaiana', description: '', isAvailable: true, extraCost: 0 },
        { id: 'napolitana', name: 'Napolitana', description: '', isAvailable: true, extraCost: 0 },
      ],
    },
    {
      id: 'special',
      name: 'Especiales',
      sizes: [
        { id: 'slice', name: 'Slice', slices: 1, maxFlavors: 1 },
        { id: 'personal', name: 'Personal', slices: 6, maxFlavors: 2, price: 24000 },
        { id: 'small', name: 'Pequeña', slices: 8, maxFlavors: 2, price: 36000 },
        { id: 'medium', name: 'Mediana', slices: 10, maxFlavors: 3, price: 55000 },
        { id: 'large', name: 'Grande', slices: 12, maxFlavors: 4, price: 70000 },
        { id: 'xlarge', name: 'XL', slices: 14, maxFlavors: 4, price: 86000 },
      ],
      flavors: [
        { id: 'pepperoni', name: 'Pepperoni', description: '', isAvailable: true, extraCost: 0 },
        // Given a surcharge on purpose: extraCost is 0 for every seeded flavor today,
        // so nothing would exercise the pro-rata charging without one here.
        { id: 'campesina', name: 'Campesina', description: '', isAvailable: true, extraCost: 4000 },
        { id: 'madrilena', name: 'Madrileña', description: '', isAvailable: true, extraCost: 0 },
      ],
    },
  ],
} as PizzaCategory;

const menu = {
  menu: [
    pizzas,
    {
      id: 'drinks',
      name: 'Bebidas',
      products: [
        { id: 'soft_drink_1_5l', name: 'Gaseosa 1.5L', isAvailable: true, price: 9000, drinkFlavors: [{ id: 'coca_cola', name: 'Coca-Cola' }, { id: 'uva', name: 'Uva' }] },
        { id: 'coca_cola_3l', name: 'Coca-Cola 3L', isAvailable: true, price: 14000 },
      ],
    },
    {
      id: 'calzones',
      name: 'Pantalón',
      products: [{ id: 'calzone', name: 'Calzone', isAvailable: true, pizzaFlavor: true, sizes: [{ id: 'small', name: 'Pequeño', price: 26000 }, { id: 'large', name: 'Grande', price: 37000 }] }],
    },
    {
      id: 'pastas',
      name: 'Pastas',
      products: [{ id: 'alfredo', name: 'Alfredo', isAvailable: true, price: 27000 }, { id: 'seafood', name: 'Marinera', isAvailable: true, price: 30000 }],
    },
    {
      id: 'lasagnas',
      name: 'Lasañas',
      products: [{ id: 'mixta', name: 'Mixta', isAvailable: true, price: 27000 }, { id: 'mamma_mia', name: 'Mamma Mia', isAvailable: true, price: 28000 }],
    },
  ],
} as unknown as Menu;

const promoSettings = { duo: { promoType: 'duo' as const, price: 37000, sodaSurcharge: 0 }, pizza_xl: { promoType: 'pizza_xl' as const, price: 86000, sodaSurcharge: 2000 } };

export function run(standalone = true) {
  resetResults();
  suite('Pizza group resolution matches the server rule');
  eq('all-classic flavors stay classic', resolvePizzaGroupId(pizzas, ['margherita', 'hawaiian']), 'classic');
  eq('one special flavor upgrades the whole pizza', resolvePizzaGroupId(pizzas, ['margherita', 'pepperoni']), 'special');
  eq('all-special stays special', resolvePizzaGroupId(pizzas, ['pepperoni', 'campesina']), 'special');
  eq('an unknown flavor does not accidentally upgrade', resolvePizzaGroupId(pizzas, ['no_such_flavor']), 'classic');

  suite('Pizza price preview matches the seeded menu');
  eq('classic large', pizzaUnitPrice(pizzas, 'large', ['margherita']), 66000);
  eq('special large', pizzaUnitPrice(pizzas, 'large', ['pepperoni']), 70000);
  eq('mixed half-and-half is priced as special', pizzaUnitPrice(pizzas, 'medium', ['margherita', 'pepperoni']), 55000);
  eq('classic XL', pizzaUnitPrice(pizzas, 'xlarge', ['margherita']), 80000);
  check('an unpriced size previews as 0 rather than NaN', pizzaUnitPrice(pizzas, 'slice', ['margherita']) === 0);

  suite('Orderable sizes exclude the unpriced slice');
  const sizes = orderablePizzaSizes(pizzas).map((s) => s.id);
  check('slice is not offered', !sizes.includes('slice'), sizes.join(','));
  eq('the five priced sizes are offered', sizes.length, 5);
  eq('flavors from both groups are listed once each', allPizzaFlavors(pizzas).length, 6);
  eq('maxFlavors is read from the size', maxFlavorsFor(pizzas, 'medium'), 3);
  eq('personal allows 2 flavors', maxFlavorsFor(pizzas, 'personal'), 2);

  suite('Flavor portions always sum to exactly 100 (the server rejects anything else)');
  for (let n = 1; n <= 4; n++) {
    for (const pattern of splitPatternsFor(n)) {
      const flavors = Array.from({ length: n }, (_, i) => `f${i}`);
      const portions = computeFlavorPortions(flavors, pattern);
      const total = portions.reduce((s, p) => s + p.portion, 0);
      check(`${n} flavors, "${pattern}" split sums to 100`, total === 100, `got ${total}: ${JSON.stringify(portions)}`);
      check(`${n} flavors, "${pattern}" split has only positive integer portions`,
        portions.every((p) => Number.isInteger(p.portion) && p.portion > 0 && p.portion <= 100), JSON.stringify(portions));
    }
  }
  eq('equal thirds give the remainder to the first flavor', computeFlavorPortions(['a', 'b', 'c'], 'equal').map((p) => p.portion), [34, 33, 33]);
  eq('the half split is 50/25/25', computeFlavorPortions(['a', 'b', 'c'], 'half', 'a').map((p) => p.portion), [50, 25, 25]);
  eq('the half split honours which flavor gets the half', computeFlavorPortions(['a', 'b', 'c'], 'half', 'b').map((p) => p.portion), [25, 50, 25]);
  eq('only 3 flavors offer a choice of split', splitPatternsFor(3).length, 2);
  eq('2 flavors have a single split', splitPatternsFor(2), ['equal']);

  suite('Portion fractions read the way staff expect');
  eq('100% prints nothing', formatPortionFraction(100), '');
  eq('50% is a half', formatPortionFraction(50), '1/2');
  eq('25% is a quarter', formatPortionFraction(25), '1/4');
  eq('34% is a third', formatPortionFraction(34), '1/3');
  eq('33% is a third', formatPortionFraction(33), '1/3');

  suite('Product price preview');
  const soda = (menu.menu[1] as any).products[0];
  const calzone = (menu.menu[2] as any).products[0];
  eq('flat product', productUnitPrice(soda), 9000);
  eq('sized product uses the chosen size', productUnitPrice(calzone, 'large'), 37000);
  eq('sized product with no size selected previews 0', productUnitPrice(calzone), 0);

  suite('Flavor surcharges are quoted the way the server charges them');
  eq('a flavor with no surcharge changes nothing', pizzaUnitPrice(pizzas, 'large', ['margherita']), 66000);
  eq('a whole surcharged flavor adds all of it', pizzaUnitPrice(pizzas, 'large', ['campesina']), 70000 + 4000);
  eq('half a surcharged flavor adds half of it',
    pizzaUnitPrice(pizzas, 'medium', ['campesina', 'pepperoni'], [{ flavor: 'campesina', portion: 50 }, { flavor: 'pepperoni', portion: 50 }]),
    55000 + 2000);
  eq('a quarter adds a quarter, rounded like the server does',
    pizzaUnitPrice(pizzas, 'large', ['campesina', 'pepperoni', 'madrilena', 'margherita'],
      [{ flavor: 'campesina', portion: 25 }, { flavor: 'pepperoni', portion: 25 }, { flavor: 'madrilena', portion: 25 }, { flavor: 'margherita', portion: 25 }]),
    70000 + 1000);
  eq('a third rounds the same way the server rounds (34%)',
    pizzaUnitPrice(pizzas, 'medium', ['campesina', 'pepperoni', 'madrilena'],
      [{ flavor: 'campesina', portion: 34 }, { flavor: 'pepperoni', portion: 33 }, { flavor: 'madrilena', portion: 33 }]),
    55000 + Math.round(4000 * 0.34));
  eq('with no split chosen yet it assumes an even one', pizzaUnitPrice(pizzas, 'medium', ['campesina', 'pepperoni']), 55000 + 2000);
  eq('a product taking a pizza flavor pays the surcharge in full', pizzaFlavorExtraCost(pizzas, 'campesina'), 4000);
  eq('and nothing for a plain flavor', pizzaFlavorExtraCost(pizzas, 'margherita'), 0);
  eq('and nothing when no flavor is chosen', pizzaFlavorExtraCost(pizzas, undefined), 0);

  suite('Duo promo preview');
  {
    const items = [
      { request: { type: 'pizza', size: 'personal', flavors: [{ flavor: 'margherita', portion: 100 }], quantity: 1 }, unitPrice: 22000 },
      { request: { type: 'product', category: 'pastas', product: 'alfredo', quantity: 1 }, unitPrice: 27000 },
    ] as any[];
    const priced = applyPromoPricingPreview('duo', items, promoSettings.duo);
    eq('cart preview totals the promo price', priced.reduce((s, i) => s + i.unitPrice, 0), 37000);
    eq('the first item carries the whole price', priced.map((i) => i.unitPrice), [37000, 0]);
    check('every item is tagged promoItem so the server prices it as a promo',
      priced.every((i) => i.request.promoItem === true), JSON.stringify(priced.map((i) => i.request.promoItem)));
    eq('duo needs 2 items', PROMO_ITEM_COUNTS.duo, 2);
  }

  suite('Pizza XL promo preview');
  {
    const build = (drinkFlavor: string) => ([
      { request: { type: 'pizza', size: 'xlarge', flavors: [{ flavor: 'margherita', portion: 100 }], quantity: 1 }, unitPrice: 80000 },
      { request: { type: 'product', category: 'drinks', product: 'soft_drink_1_5l', drinkFlavor, quantity: 1 }, unitPrice: 9000 },
      { request: { type: 'product', category: 'appetizers', product: 'garlic_bread', quantity: 1 }, unitPrice: 10000 },
    ] as any[]);

    const free = applyPromoPricingPreview('pizza_xl', build('uva'), promoSettings.pizza_xl);
    eq('a free soda flavor keeps the promo at its flat price', free.reduce((s, i) => s + i.unitPrice, 0), 86000);
    eq('bread and soda are both zeroed', free.map((i) => i.unitPrice), [86000, 0, 0]);

    const surcharged = applyPromoPricingPreview('pizza_xl', build('coca_cola'), promoSettings.pizza_xl);
    eq('a surcharged soda flavor adds exactly the surcharge', surcharged.reduce((s, i) => s + i.unitPrice, 0), 88000);
    eq('the surcharge lands on the soda line', surcharged.map((i) => i.unitPrice), [86000, 2000, 0]);
    eq('pizza_xl needs 3 items', PROMO_ITEM_COUNTS.pizza_xl, 3);

    check('the surcharge flavor set matches the server list',
      [...XL_SODA_SURCHARGE_FLAVORS].sort().join(',') === 'coca_cola,premio,quatro',
      [...XL_SODA_SURCHARGE_FLAVORS].join(','));
  }

  suite('Duo eligibility matches the server exclusions');
  check('a personal single-flavor pizza qualifies', isPizzaEligibleForDuo('personal', [{ flavor: 'margherita', portion: 100 }]));
  check('a bigger size does not', !isPizzaEligibleForDuo('large', [{ flavor: 'margherita', portion: 100 }]));
  check('mitad y mitad does not', !isPizzaEligibleForDuo('personal', [{ flavor: 'margherita', portion: 50 }, { flavor: 'hawaiian', portion: 50 }]));
  for (const flavor of DUO_EXCLUDED_FLAVORS) {
    check(`the excluded flavor "${flavor}" does not qualify`, !isPizzaEligibleForDuo('personal', [{ flavor, portion: 100 }]));
  }
  check('Mamma Mia is excluded from duo', !isProductEligibleForPromo('duo', 'lasagnas', 'mamma_mia'));
  check('other lasagnas are not', isProductEligibleForPromo('duo', 'lasagnas', 'mixta'));
  check('Marinera pasta is excluded from duo', !isProductEligibleForPromo('duo', 'pastas', 'seafood'));
  check('other pastas are not', isProductEligibleForPromo('duo', 'pastas', 'alfredo'));
  check('pizza_xl narrows drinks to the 1.5L soda', isProductEligibleForPromo('pizza_xl', 'drinks', 'soft_drink_1_5l'));
  check('pizza_xl rejects the 3L bottle', !isProductEligibleForPromo('pizza_xl', 'drinks', 'coca_cola_3l'));
  check('with no promo active nothing is filtered out', isProductEligibleForPromo(undefined, 'drinks', 'coca_cola_3l'));
  eq('the drinks list is filtered down to one product during pizza_xl',
    eligibleProductsForPromo('pizza_xl', 'drinks', (menu.menu[1] as any).products).map((p: any) => p.id), ['soft_drink_1_5l']);

  suite('Cart line grouping');
  {
    const item = (unitPrice: number, quantity: number, notes: string | null = null) => ({
      id: Math.random(), orderId: 1, quantity, unitPrice, notes, printedAt: null,
      menuItemRef: { category: 'drinks', product: 'coca_cola_3l' }, pizzaRef: null,
    }) as any;
    const grouped = groupOrderItems(menu, [item(14000, 1), item(14000, 2)]);
    eq('identical lines merge into one row', grouped.length, 1);
    eq('quantities are summed', grouped[0].quantity, 3);
    const mixed = groupOrderItems(menu, [item(14000, 1), item(0, 1)]);
    eq('a promo-priced copy stays a separate row so the price is never wrong', mixed.length, 2);
    const noted = groupOrderItems(menu, [item(14000, 1), item(14000, 1, 'sin hielo')]);
    eq('different notes stay separate rows', noted.length, 2);
  }

  summary({ exit: standalone });
}

if (isEntrypoint(import.meta.url)) run();
