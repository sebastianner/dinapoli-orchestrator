import type { Menu, PizzaCategory, PizzaFlavor, PizzaGroupId, PizzaSize, Product, ProductCategory, ProductCategoryId } from '@/types/api';
import { isPizzaCategory } from '@/types/api';

/**
 * The public /api/menu payload doesn't expose per-flavor extra_cost or a
 * flavor's owning group (see server/src/services/orderService.ts), so these
 * helpers can only reproduce the *base* group+size price client-side. The
 * server always recomputes the authoritative price on submission; this is
 * strictly a best-effort preview for the cart.
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

export function pizzaUnitPrice(pizzas: PizzaCategory, sizeId: string, flavorIds: string[]): number {
  const groupId = resolvePizzaGroupId(pizzas, flavorIds);
  const group = pizzas.groups.find((g) => g.id === groupId);
  const size = group?.sizes.find((s) => s.id === sizeId);
  return size?.price ?? 0;
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
