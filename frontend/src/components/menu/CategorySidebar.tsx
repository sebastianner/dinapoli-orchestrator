import { Link } from '@tanstack/react-router';
import { CupSoda, Flame, IceCream, Layers, Pizza, Sandwich, Soup, UtensilsCrossed } from 'lucide-react';
import type { Menu, MenuCategory } from '@/types/api';

const categoryIcons: Record<string, React.ComponentType<{ size?: number }>> = {
  pizzas: Pizza,
  appetizers: Soup,
  gratinados: Flame,
  calzones: Sandwich,
  pastas: UtensilsCrossed,
  lasagnas: Layers,
  drinks: CupSoda,
  desserts: IceCream,
};

function categoryHref(category: MenuCategory): { to: string; params?: Record<string, string> } {
  if (category.id === 'pizzas') return { to: '/menu/pizzas' };
  if (category.id === 'calzones') return { to: '/menu/calzone' };
  return { to: '/menu/$category', params: { category: category.id } };
}

interface CategorySidebarProps {
  menu: Menu;
}

export function CategorySidebar({ menu }: CategorySidebarProps) {
  return (
    <nav className="flex w-28 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-surface py-4">
      {menu.menu.map((category) => {
        const Icon = categoryIcons[category.id] ?? UtensilsCrossed;
        const { to, params } = categoryHref(category);
        return (
          <Link
            key={category.id}
            to={to}
            params={params}
            className="group flex flex-col items-center gap-1.5 px-2 py-3 text-text-secondary transition-colors duration-fast hover:text-brand-600 data-[status=active]:text-brand-600"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 transition-colors duration-fast group-data-[status=active]:bg-brand-500 group-data-[status=active]:text-white">
              <Icon size={22} />
            </span>
            <span className="text-center text-[11px] font-medium leading-tight">{category.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
