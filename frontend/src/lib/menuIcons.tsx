import { CupSoda, Flame, IceCream, Layers, Pizza, Sandwich, Soup, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import type { ProductCategoryId } from '@/types/api';

/** One icon per menu category, shared by CategorySidebar (category nav) and ProductCard (per-card badge) so a product always carries the same icon its category link does. */
export const categoryIcons: Record<ProductCategoryId, LucideIcon> = {
  appetizers: Soup,
  gratinados: Flame,
  calzones: Sandwich,
  pastas: UtensilsCrossed,
  lasagnas: Layers,
  drinks: CupSoda,
  desserts: IceCream,
};

export const DEFAULT_CATEGORY_ICON: LucideIcon = UtensilsCrossed;

export function categoryIcon(categoryId: ProductCategoryId | 'pizzas'): LucideIcon {
  if (categoryId === 'pizzas') return Pizza;
  return categoryIcons[categoryId] ?? DEFAULT_CATEGORY_ICON;
}
