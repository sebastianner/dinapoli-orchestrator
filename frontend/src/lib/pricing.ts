import type { Menu, OrderItem, PizzaCategory, PizzaFlavor, PizzaGroupId, PizzaSize, Product, ProductCategory, ProductCategoryId } from '@/types/api';
import { isPizzaCategory } from '@/types/api';

/**
 * Client-side price preview for the cart. The server always recomputes the
 * authoritative price on submission (see server/src/services/orderService.ts) -
 * this exists so the running total in the Order Overview matches what the
 * customer will be charged, not to decide it.
 *
 * That match is the whole point, so these helpers reproduce the server's rules
 * exactly: the group is derived from the flavors picked (any 'special' flavor
 * upgrades the pizza), and each flavor's `extraCost` is added pro-rata by
 * portion, rounded per flavor, the same way resolvePizzaItem does it.
 */

export function getPizzaCategory(menu: Menu): PizzaCategory | undefined {
  return menu.menu.find(isPizzaCategory);
}

export function getProductCategory(menu: Menu, categoryId: ProductCategoryId): ProductCategory | undefined {
  const category = menu.menu.find((c) => c.id === categoryId);
  return category && !isPizzaCategory(category) ? category : undefined;
}

export function getProduct(menu: Menu, categoryId: ProductCategoryId, productId: string): Product | undefined {
  return getProductCategory(menu, categoryId)?.products.find((p) => p.id === productId);
}

/** Sizes that can actually be ordered — 'slice' has no configured price in this menu. */
export function orderablePizzaSizes(pizzas: PizzaCategory): PizzaSize[] {
  const sizes = new Map<string, PizzaSize>();
  for (const group of pizzas.groups) {
    for (const size of group.sizes) {
      if (size.price != null) sizes.set(size.id, size);
    }
  }
  return [...sizes.values()];
}

/** All flavors offered across both groups, each appearing under exactly one. */
export function allPizzaFlavors(pizzas: PizzaCategory): PizzaFlavor[] {
  const seen = new Map<string, PizzaFlavor>();
  for (const group of pizzas.groups) {
    for (const flavor of group.flavors) seen.set(flavor.id, flavor);
  }
  return [...seen.values()];
}

/** A flavor belongs to whichever group lists it; picking any 'special' flavor upgrades the whole pizza. */
export function resolvePizzaGroupId(pizzas: PizzaCategory, flavorIds: string[]): PizzaGroupId {
  const specialIds = new Set(pizzas.groups.find((g) => g.id === 'special')?.flavors.map((f) => f.id));
  return flavorIds.some((id) => specialIds?.has(id)) ? 'special' : 'classic';
}

/**
 * Base group+size price plus each flavor's own surcharge, scaled by how much of
 * the pizza that flavor covers - mirroring orderService.resolvePizzaItem's
 * `Math.round(extra_cost * portion / 100)` per flavor, including the rounding,
 * so the two agree to the peso.
 *
 * `portions` is optional: the flavor picker calls this before the split has
 * been chosen, and an even split is the right assumption at that point.
 */
export function pizzaUnitPrice(
  pizzas: PizzaCategory,
  sizeId: string,
  flavorIds: string[],
  portions?: { flavor: string; portion: number }[],
): number {
  const groupId = resolvePizzaGroupId(pizzas, flavorIds);
  const group = pizzas.groups.find((g) => g.id === groupId);
  const size = group?.sizes.find((s) => s.id === sizeId);
  if (size?.price == null) return 0;

  const byId = new Map(allPizzaFlavors(pizzas).map((f) => [f.id, f]));
  const evenShare = flavorIds.length > 0 ? 100 / flavorIds.length : 0;
  const extra = flavorIds.reduce((sum, id) => {
    const extraCost = byId.get(id)?.extraCost ?? 0;
    if (extraCost === 0) return sum;
    const portion = portions?.find((p) => p.flavor === id)?.portion ?? evenShare;
    return sum + Math.round((extraCost * portion) / 100);
  }, 0);

  return size.price + extra;
}

/** A product that takes a pizza flavor (gratinado, calzone) pays that flavor's surcharge in full - see orderService.resolveProductItem. */
export function pizzaFlavorExtraCost(pizzas: PizzaCategory | undefined, flavorId: string | undefined): number {
  if (!pizzas || !flavorId) return 0;
  return allPizzaFlavors(pizzas).find((f) => f.id === flavorId)?.extraCost ?? 0;
}

export function maxFlavorsFor(pizzas: PizzaCategory, sizeId: string): number {
  for (const group of pizzas.groups) {
    const size = group.sizes.find((s) => s.id === sizeId);
    if (size) return size.maxFlavors;
  }
  return 1;
}

/**
 * How a pizza can be split by number of flavors. Only 3-flavor pizzas have a
 * real choice: equal thirds, or one flavor at half with the other two at a
 * quarter each. 1, 2, and 4 flavors only ever split evenly.
 */
export type FlavorSplitPattern = 'equal' | 'half';

export function splitPatternsFor(flavorCount: number): FlavorSplitPattern[] {
  return flavorCount === 3 ? ['equal', 'half'] : ['equal'];
}

/**
 * Turns selected flavor ids + a chosen pattern into { flavor, portion } pairs
 * summing to exactly 100. 'equal' thirds can't divide evenly (100/3), so
 * that remainder goes to the first selected flavor (34/33/33).
 */
export function computeFlavorPortions(
  selectedFlavors: string[],
  pattern: FlavorSplitPattern,
  halfFlavorId?: string,
): { flavor: string; portion: number }[] {
  const n = selectedFlavors.length;
  if (n === 0) return [];
  if (pattern === 'half' && n === 3) {
    const big = halfFlavorId ?? selectedFlavors[0];
    return selectedFlavors.map((f) => ({ flavor: f, portion: f === big ? 50 : 25 }));
  }
  const base = Math.floor(100 / n);
  const remainder = 100 - base * n;
  return selectedFlavors.map((f, i) => ({ flavor: f, portion: i === 0 ? base + remainder : base }));
}

/** Percent -> the simplified fraction it represents, e.g. 25 -> "1/4". Empty for a whole (100%) flavor. */
export function formatPortionFraction(portion: number): string {
  if (portion >= 100) return '';
  // 100/3 isn't an integer, so equal thirds are stored as 34/33/33 - still just "1/3" to a reader.
  if (portion === 33 || portion === 34) return '1/3';
  const divisor = gcd(portion, 100);
  return `${portion / divisor}/${100 / divisor}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function productUnitPrice(product: Product, sizeId?: string): number {
  if (product.sizes && product.sizes.length > 0) {
    return product.sizes.find((s) => s.id === sizeId)?.price ?? 0;
  }
  return product.price ?? 0;
}

function pizzaSizeName(pizzas: PizzaCategory, sizeId: string): string {
  for (const group of pizzas.groups) {
    const size = group.sizes.find((s) => s.id === sizeId);
    if (size) return size.name;
  }
  return sizeId;
}

/** Order items only carry menu ids (e.g. 'margherita', 'large') - resolve them to their Spanish menu names for display. */
export function describeOrderItem(menu: Menu | undefined, item: OrderItem): string {
  const pizzas = menu ? getPizzaCategory(menu) : undefined;
  const flavorName = (flavorId: string) => (pizzas ? (allPizzaFlavors(pizzas).find((f) => f.id === flavorId)?.name ?? flavorId) : flavorId);

  if (item.pizzaRef) {
    const sizeName = pizzas ? pizzaSizeName(pizzas, item.pizzaRef.size) : item.pizzaRef.size;
    const flavorNames = item.pizzaRef.flavors.map(({ flavor, portion }) => {
      const name = flavorName(flavor);
      const fraction = formatPortionFraction(portion);
      return fraction ? `${name} (${fraction})` : name;
    });
    return `Pizza ${sizeName} - ${flavorNames.join(', ')}`;
  }

  const ref = item.menuItemRef;
  if (!ref) return 'Producto';
  const product = menu ? getProduct(menu, ref.category, ref.product) : undefined;
  // Category name leads, mirroring the kitchen ticket's own "Categoría -
  // Producto..." format (see server printerService.describeItem) -
  // product.name alone reads fine for some categories (Bebidas' "Gaseosa")
  // but is just a flavor name for others (Pastas'/Lasañas'/Entradas'
  // products).
  const categoryName = menu ? (getProductCategory(menu, ref.category)?.name ?? ref.category) : ref.category;
  // A pizza-flavor product's own name (e.g. "Gratinado", "Pantalón") is just
  // a placeholder for "whichever flavor you pick" - it has no identity
  // beyond the category, so it'd otherwise duplicate categoryName right next
  // to it ("Gratinados - Gratinado - Napolitana").
  const bits = ref.pizzaFlavor ? [categoryName] : [categoryName, product?.name ?? ref.product];
  if (ref.size) bits.push(product?.sizes?.find((s) => s.id === ref.size)?.name ?? ref.size);
  if (ref.drinkFlavor) bits.push(product?.drinkFlavors?.find((f) => f.id === ref.drinkFlavor)?.name ?? ref.drinkFlavor);
  if (ref.pizzaFlavor) bits.push(flavorName(ref.pizzaFlavor));
  return bits.join(' - ');
}

export interface GroupedOrderItem {
  key: string;
  description: string;
  notes: string | null;
  unitPrice: number;
  quantity: number;
  promoGroup: number | null;
  /** The underlying order_items rows folded into this display row, in the order they were added - each is its own id to include in an editOrderItems removeItemIds batch (a row's own `quantity` may be >1, so removing one id can drop the displayed quantity by more than 1). */
  itemIds: number[];
}

/** Collapses repeated additions of the same item (same ref + notes + price + promo group) into one row with a summed quantity. */
export function groupOrderItems(menu: Menu | undefined, items: OrderItem[]): GroupedOrderItem[] {
  const groups = new Map<string, GroupedOrderItem>();
  for (const item of items) {
    const key = JSON.stringify([item.pizzaRef, item.menuItemRef, item.notes, item.unitPrice, item.promoGroup]);
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      existing.itemIds.push(item.id);
    } else {
      groups.set(key, {
        key,
        description: describeOrderItem(menu, item),
        notes: item.notes,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        promoGroup: item.promoGroup,
        itemIds: [item.id],
      });
    }
  }
  return [...groups.values()];
}
