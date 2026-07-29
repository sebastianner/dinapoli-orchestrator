import { formatCOP } from '@/lib/format';
import type { OrderItemRequest, PizzaSizeId, ProductCategoryId, PromoSettings, PromoType } from '@/types/api';

// Mirrors server/src/services/orderService.ts's validatePromoItems/applyPromoPricing -
// this is a client-side PREVIEW only (cart display), the server always
// recomputes and enforces the authoritative price/eligibility on submission.
// Prices themselves are admin-editable (see /ajustes/promos,
// usePromoSettings) rather than hardcoded here - every function below that
// needs a price takes the current PromoSettings as a parameter.

export const PROMO_LABELS: Record<PromoType, string> = {
  duo: 'Dúo',
  pizza_xl: 'Pizza XL',
};

/** How many items must be collected before a promo draft auto-finalizes into the cart (see useOrderStore.addPromoItem). */
export const PROMO_ITEM_COUNTS: Record<PromoType, number> = {
  duo: 2,
  pizza_xl: 3, // XL pizza + gaseosa + the auto-added free bread
};

/** How many of those items are an actual user choice (pizza_xl's bread is automatic) - drives the progress banner's "1/2" copy. */
export const PROMO_CHOICES_NEEDED: Record<PromoType, number> = {
  duo: 2,
  pizza_xl: 2, // pizza + gaseosa
};

/** Menu categories reachable while a promo draft is active - everything else is locked in CategorySidebar/$category. */
export const PROMO_ALLOWED_CATEGORIES: Record<PromoType, Set<ProductCategoryId | 'pizzas'>> = {
  duo: new Set(['pizzas', 'lasagnas', 'pastas', 'gratinados']),
  pizza_xl: new Set(['pizzas', 'drinks']),
};

/** Pizza sizes selectable while a promo draft is active (see pizzas/index.tsx). */
export const PROMO_ALLOWED_SIZES: Record<PromoType, Set<PizzaSizeId>> = {
  duo: new Set(['personal']),
  pizza_xl: new Set(['xlarge']),
};

/** "Dúo (2x$37.000) - elige 2 (1/2)"-style progress text for the promo banner. */
export function promoProgressText(type: PromoType, itemCount: number, settings: PromoSettings): string {
  const autoItems = type === 'pizza_xl' ? 1 : 0; // the free bread doesn't count as a user choice
  const chosen = itemCount - autoItems;
  const needed = PROMO_CHOICES_NEEDED[type];
  const priceLabel = type === 'duo' ? `2x${formatCOP(settings.price)}` : formatCOP(settings.price);
  return `${PROMO_LABELS[type]} (${priceLabel}) - elige ${needed} (${chosen}/${needed})`;
}

/** These 5 "special" flavors are excluded from the 'duo' promo whether picked as a personal pizza's single flavor or a gratinado's pizzaFlavor. */
export const DUO_EXCLUDED_FLAVORS = new Set(['campesina', 'madrilena', 'atarraya', 'tricaccio', 'ardiente']);

/** Coca-Cola and Quatro are the two soft_drink flavors that add a surcharge inside the 'pizza_xl' promo; every other flavor is free. The surcharge amount itself is admin-editable (PromoSettings.sodaSurcharge), this is just which flavors trigger it. */
export const XL_SODA_SURCHARGE_FLAVORS = new Set(['coca_cola', 'quatro']);

export function isPizzaEligibleForDuo(size: PizzaSizeId, flavors: { flavor: string; portion: number }[]): boolean {
  if (size !== 'personal') return false;
  if (flavors.length !== 1 || flavors[0].portion !== 100) return false; // no mitad y mitad
  return !DUO_EXCLUDED_FLAVORS.has(flavors[0].flavor);
}

export function isLasagnaEligibleForDuo(productId: string): boolean {
  return productId !== 'mamma_mia';
}

export function isPastaEligibleForDuo(productId: string): boolean {
  return productId !== 'seafood';
}

export function isGratinEligibleForDuo(pizzaFlavor: string | undefined): boolean {
  return !pizzaFlavor || !DUO_EXCLUDED_FLAVORS.has(pizzaFlavor);
}

/** Duo excludes specific products within an otherwise-eligible category; pizza_xl narrows drinks down to just the one soda. Used both per-category (menu/$category.tsx) and per-result (menu/todos.tsx, whose search results span every category at once). */
export function isProductEligibleForPromo(promoType: PromoType | undefined, categoryId: ProductCategoryId, productId: string): boolean {
  if (promoType === 'duo' && categoryId === 'lasagnas') return productId !== 'mamma_mia';
  if (promoType === 'duo' && categoryId === 'pastas') return productId !== 'seafood';
  if (promoType === 'pizza_xl' && categoryId === 'drinks') return productId === 'soft_drink';
  return true;
}

export function eligibleProductsForPromo<T extends { id: string }>(promoType: PromoType | undefined, categoryId: ProductCategoryId, products: T[]): T[] {
  return products.filter((p) => isProductEligibleForPromo(promoType, categoryId, p.id));
}

/** Free bread that's auto-added the moment a 'pizza_xl' promo starts - no user choice involved (see useOrderStore.startPromo). */
export function freeBreadRequest(): OrderItemRequest {
  return { type: 'product', category: 'appetizers', product: 'garlic_bread', quantity: 1 };
}

/**
 * Applies the promo's flat pricing (from the current, admin-editable
 * PromoSettings) to a completed set of draft items, for cart display only.
 * 'duo': the first item carries the full price, the second is free.
 * 'pizza_xl': the pizza carries the full price, the bread is free, and the
 * soda is free unless a surcharge option (Coca-Cola/Quatro) was chosen.
 */
export function applyPromoPricingPreview<T extends { request: OrderItemRequest; unitPrice: number }>(
  promoType: PromoType,
  items: T[],
  settings: PromoSettings
): T[] {
  if (promoType === 'duo') {
    return items.map((item, i) => ({ ...item, unitPrice: i === 0 ? settings.price : 0 }));
  }
  return items.map((item) => {
    if (item.request.type === 'pizza') return { ...item, unitPrice: settings.price };
    if (item.request.type === 'product' && item.request.category === 'drinks') {
      const surcharge = item.request.drinkFlavor && XL_SODA_SURCHARGE_FLAVORS.has(item.request.drinkFlavor) ? settings.sodaSurcharge : 0;
      return { ...item, unitPrice: surcharge };
    }
    return { ...item, unitPrice: 0 };
  });
}
