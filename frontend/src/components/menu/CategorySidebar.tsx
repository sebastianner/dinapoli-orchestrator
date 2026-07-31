import { Link } from '@tanstack/react-router';
import { LayoutGrid, Sparkles } from 'lucide-react';
import { useOrderStore } from '@/store/useOrderStore';
import { PROMO_ALLOWED_CATEGORIES } from '@/lib/promos';
import { categoryIcon } from '@/lib/menuIcons';
import type { Menu, MenuCategory } from '@/types/api';

function categoryHref(category: MenuCategory): { to: string; params?: Record<string, string> } {
  if (category.id === 'pizzas') return { to: '/menu/pizzas' };
  if (category.id === 'calzones') return { to: '/menu/calzone' };
  return { to: '/menu/$category', params: { category: category.id } };
}

interface CategorySidebarProps {
  menu: Menu;
}

export function CategorySidebar({ menu }: CategorySidebarProps) {
  const promoDraft = useOrderStore((s) => s.promoDraft);
  const allowedCategories = promoDraft ? PROMO_ALLOWED_CATEGORIES[promoDraft.type] : null;

  return (
    <>
      {/* Tablet/desktop: vertical rail, unchanged. Hidden below md in favor of
          the horizontal scroller (see below) - a w-28 column eats too much
          width next to the product grid on a phone. */}
      <nav className="hidden w-28 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-surface py-4 md:flex">
        <Link
          to="/menu/promos"
          className="group flex flex-col items-center gap-1.5 px-2 py-3 text-text-secondary transition-colors duration-fast hover:text-brand-600 data-[status=active]:text-brand-600"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 transition-colors duration-fast group-data-[status=active]:bg-brand-500 group-data-[status=active]:text-white">
            <Sparkles size={24} />
          </span>
          <span className="text-center text-sm font-medium leading-tight">Promos</span>
        </Link>
        <hr className="mx-3 my-1 border-border" />

        <Link
          to="/menu/todos"
          className="group flex flex-col items-center gap-1.5 px-2 py-3 text-text-secondary transition-colors duration-fast hover:text-brand-600 data-[status=active]:text-brand-600"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 transition-colors duration-fast group-data-[status=active]:bg-brand-500 group-data-[status=active]:text-white">
            <LayoutGrid size={24} />
          </span>
          <span className="text-center text-sm font-medium leading-tight">Todos</span>
        </Link>

        {menu.menu.map((category) => {
          const Icon = categoryIcon(category.id);
          const { to, params } = categoryHref(category);
          const isLocked = allowedCategories != null && !allowedCategories.has(category.id);

          if (isLocked) {
            return (
              <div key={category.id} title="No disponible con la promoción activa" className="flex cursor-not-allowed flex-col items-center gap-1.5 px-2 py-3 opacity-40">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600">
                  <Icon size={24} />
                </span>
                <span className="text-center text-sm font-medium leading-tight text-text-secondary">{category.name}</span>
              </div>
            );
          }

          return (
            <Link
              key={category.id}
              to={to}
              params={params}
              className="group flex flex-col items-center gap-1.5 px-2 py-3 text-text-secondary transition-colors duration-fast hover:text-brand-600 data-[status=active]:text-brand-600"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 transition-colors duration-fast group-data-[status=active]:bg-brand-500 group-data-[status=active]:text-white">
                <Icon size={24} />
              </span>
              <span className="text-center text-sm font-medium leading-tight">{category.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Phone: same links, horizontal scroller pinned above the product
          grid instead of a vertical column. overflow-x-auto + shrink-0 items
          is the same safety-net pattern as the mobile bottom nav (Sidebar). */}
      <nav className="flex w-full shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface px-2 py-2 md:hidden">
        <Link
          to="/menu/promos"
          className="group flex shrink-0 flex-col items-center gap-1 px-2 py-1 text-text-secondary transition-colors duration-fast data-[status=active]:text-brand-600"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 transition-colors duration-fast group-data-[status=active]:bg-brand-500 group-data-[status=active]:text-white">
            <Sparkles size={18} />
          </span>
          <span className="text-center text-[11px] font-medium leading-tight">Promos</span>
        </Link>

        <Link
          to="/menu/todos"
          className="group flex shrink-0 flex-col items-center gap-1 px-2 py-1 text-text-secondary transition-colors duration-fast data-[status=active]:text-brand-600"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 transition-colors duration-fast group-data-[status=active]:bg-brand-500 group-data-[status=active]:text-white">
            <LayoutGrid size={18} />
          </span>
          <span className="text-center text-[11px] font-medium leading-tight">Todos</span>
        </Link>

        {menu.menu.map((category) => {
          const Icon = categoryIcon(category.id);
          const { to, params } = categoryHref(category);
          const isLocked = allowedCategories != null && !allowedCategories.has(category.id);

          if (isLocked) {
            return (
              <div
                key={category.id}
                title="No disponible con la promoción activa"
                className="flex shrink-0 cursor-not-allowed flex-col items-center gap-1 px-2 py-1 opacity-40"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600">
                  <Icon size={18} />
                </span>
                <span className="text-center text-[11px] font-medium leading-tight text-text-secondary">{category.name}</span>
              </div>
            );
          }

          return (
            <Link
              key={category.id}
              to={to}
              params={params}
              className="group flex shrink-0 flex-col items-center gap-1 px-2 py-1 text-text-secondary transition-colors duration-fast data-[status=active]:text-brand-600"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 transition-colors duration-fast group-data-[status=active]:bg-brand-500 group-data-[status=active]:text-white">
                <Icon size={18} />
              </span>
              <span className="text-center text-[11px] font-medium leading-tight">{category.name}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
