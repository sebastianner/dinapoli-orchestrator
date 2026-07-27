import type { OrderItemRequest, PizzaSizeId, ProductCategoryId, PromoType } from '@/types/api';

// Mirrors server/src/services/orderService.ts's validatePromoItems/applyPromoPricing -
// this is a client-side PREVIEW only (cart display), the server always
// recomputes and enforces the authoritative price/eligibility on submission.

export const PROMO_LABELS: Record<PromoType, string> = {
  duo: 'Dúo (2x$37.000)',
  pizza_xl: 'Pizza XL ($80.000)',
};

export const PROMO_PRICES: Record<PromoType, number> = {
  duo: 37000,
  pizza_xl: 80000,
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

/** "Elige tu pizza y tu gaseosa (1/2)"-style progress text for the promo banner. */
export function promoProgressText(type: PromoType, itemCount: number): string {
  const autoItems = type === 'pizza_xl' ? 1 : 0; // the free bread doesn't count as a user choice
  const chosen = itemCount - autoItems;
  const needed = PROMO_CHOICES_NEEDED[type];
  return `${PROMO_LABELS[type]} - elige ${needed} (${chosen}/${needed})`;
}

/** These 5 "special" flavors are excluded from the 'duo' promo whether picked as a personal pizza's single flavor or a gratinado's pizzaFlavor. */
export const DUO_EXCLUDED_FLAVORS = new Set(['campesina', 'madrilena', 'atarraya', 'tricaccio', 'ardiente']);

/** Coca-Cola and Quatro are the two soft_drink options that add a surcharge inside the 'pizza_xl' promo; every other option is free. */
export const XL_SODA_SURCHARGE_OPTIONS = new Set(['coca_cola', 'quatro']);
export const XL_SODA_SURCHARGE = 2000;

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

/** Free bread that's auto-added the moment a 'pizza_xl' promo starts - no user choice involved (see useOrderStore.startPromo). */
export function freeBreadRequest(): OrderItemRequest {
  return { type: 'product', category: 'appetizers', product: 'garlic_bread', quantity: 1 };
}

/**
 * Applies the promo's flat pricing to a completed set of draft items, for cart
 * display only. 'duo': the first item carries the full $37,000, the second is
 * free. 'pizza_xl': the pizza carries the full $80,000, the bread is free, and
 * the soda is free unless a surcharge option (Coca-Cola/Quatro) was chosen.
 */
export function applyPromoPricingPreview<T extends { request: OrderItemRequest; unitPrice: number }>(promoType: PromoType, items: T[]): T[] {
  if (promoType === 'duo') {
    return items.map((item, i) => ({ ...item, unitPrice: i === 0 ? PROMO_PRICES.duo : 0 }));
  }
  return items.map((item) => {
    if (item.request.type === 'pizza') return { ...item, unitPrice: PROMO_PRICES.pizza_xl };
    if (item.request.type === 'product' && item.request.category === 'drinks') {
      const surcharge = item.request.option && XL_SODA_SURCHARGE_OPTIONS.has(item.request.option) ? XL_SODA_SURCHARGE : 0;
      return { ...item, unitPrice: surcharge };
    }
    return { ...item, unitPrice: 0 };
  });
}
