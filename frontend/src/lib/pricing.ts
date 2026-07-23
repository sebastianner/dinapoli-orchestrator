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

export function productUnitPrice(product: Product, sizeId?: string): number {
  if (product.sizes && product.sizes.length > 0) {
    return product.sizes.find((s) => s.id === sizeId)?.price ?? 0;
  }
  return product.price ?? 0;
}
