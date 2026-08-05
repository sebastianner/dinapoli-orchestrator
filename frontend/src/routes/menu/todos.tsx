import { useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useMenu, usePizzaFlavorSearch, useProductSearch } from '@/lib/queries';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { allPizzaFlavors, getPizzaCategory } from '@/lib/pricing';
import { ProductCard } from '@/components/menu/ProductCard';
import { useOrderStore } from '@/store/useOrderStore';
import { DUO_EXCLUDED_FLAVORS, PROMO_ALLOWED_CATEGORIES, eligibleProductsForPromo, isProductEligibleForPromo } from '@/lib/promos';
import { categoryIcon } from '@/lib/menuIcons';
import { formatCOP } from '@/lib/format';
import { isPizzaCategory } from '@/types/api';
import type { Product, ProductCategory, ProductCategoryId } from '@/types/api';

export const Route = createFileRoute('/menu/todos')({
  component: TodosPage,
});

interface FlatProduct {
  categoryId: ProductCategoryId;
  product: Product;
}

function TodosPage() {
  const { data: menu, isLoading } = useMenu();
  const promoDraft = useOrderStore((s) => s.promoDraft);
  const allowedCategories = promoDraft ? PROMO_ALLOWED_CATEGORIES[promoDraft.type] : null;

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);
  const trimmed = debouncedQuery.trim();
  const isSearching = trimmed !== '';

  const { data: searchResults = [], isLoading: isSearchLoading } = useProductSearch(trimmed);
  const { data: flavorMatches = [] } = usePizzaFlavorSearch(trimmed);

  // Default (no query) view: every product across every non-pizza category,
  // flattened - pizzas keep their own dedicated size/flavor flow and can't
  // render through ProductCard.
  const allProducts: FlatProduct[] = useMemo(() => {
    if (!menu) return [];
    const items: FlatProduct[] = [];
    for (const category of menu.menu) {
      if (isPizzaCategory(category)) continue;
      if (allowedCategories && !allowedCategories.has(category.id)) continue;
      for (const product of eligibleProductsForPromo(promoDraft?.type, category.id, category.products)) {
        items.push({ categoryId: category.id, product });
      }
    }
    return items;
  }, [menu, promoDraft?.type, allowedCategories]);

  // Search results span every category regardless of promo state - filter
  // them down the same way allProducts already is, rather than trusting the
  // backend (which knows nothing about the client's active promo draft).
  const filteredResults: FlatProduct[] = useMemo(
    () =>
      searchResults
        .filter((r) => (!allowedCategories || allowedCategories.has(r.categoryId)) && isProductEligibleForPromo(promoDraft?.type, r.categoryId, r.id))
        .map(({ categoryId, ...product }) => ({ categoryId, product })),
    [searchResults, promoDraft?.type, allowedCategories]
  );

  const results = isSearching ? filteredResults : allProducts;

  // Grouped by category, in the same order the sidebar lists them - both for
  // the default browse-everything view and for search results (which span
  // categories too, so still worth separating rather than one mixed grid).
  const groups = useMemo(() => {
    if (!menu) return [];
    const byCategory = new Map<ProductCategoryId, FlatProduct[]>();
    for (const item of results) {
      const list = byCategory.get(item.categoryId);
      if (list) list.push(item);
      else byCategory.set(item.categoryId, [item]);
    }
    return menu.menu
      .filter((c): c is ProductCategory => !isPizzaCategory(c))
      .filter((c) => byCategory.has(c.id))
      .map((c) => ({ categoryId: c.id, categoryName: c.name, items: byCategory.get(c.id)! }));
  }, [menu, results]);

  const pizzaCategory = menu ? getPizzaCategory(menu) : undefined;
  const flavors = pizzaCategory ? allPizzaFlavors(pizzaCategory) : [];
  const pizzaAllowed = !!pizzaCategory && (!allowedCategories || allowedCategories.has('pizzas'));
  // Own size/flavor flow, like calzone - can't render through ProductCard, so
  // a search match (by flavor name, or the category name itself) still has to
  // route through the tile below rather than a normal result card.
  const pizzaNameMatches = isSearching && !!pizzaCategory && pizzaCategory.name.toLowerCase().includes(trimmed.toLowerCase());
  const matchedFlavorNames = isSearching ? flavorMatches.map((f) => f.name) : [];
  const showPizzaTile = pizzaAllowed && (!isSearching || matchedFlavorNames.length > 0 || pizzaNameMatches);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-text-primary">Todos</h1>

      <div className="relative mb-6 max-w-md">
        <span className="pointer-events-none absolute left-3 flex items-center text-text-secondary" style={{ top: 0, bottom: 0 }}>
          <Search size={17} />
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar producto..."
          className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3 text-sm text-text-primary outline-none focus:border-brand-400"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-text-secondary">Cargando...</p>
      ) : isSearching && isSearchLoading ? (
        <p className="text-sm text-text-secondary">Buscando...</p>
      ) : groups.length === 0 && !showPizzaTile ? (
        <p className="text-sm text-text-secondary">{isSearching ? `Nada coincide con "${trimmed}".` : 'No hay productos disponibles.'}</p>
      ) : (
        <div className="flex flex-col gap-8">
          {showPizzaTile && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">{pizzaCategory!.name}</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <PizzaCategoryLink matchedFlavorNames={matchedFlavorNames} />
              </div>
            </section>
          )}
          {groups.map((group) => (
            <section key={group.categoryId}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">{group.categoryName}</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map(({ categoryId, product }) =>
                  // Calzone ("Pantalón") is priced per size, not per product - ProductCard has
                  // no size picker (that's the dedicated /menu/calzone flow's job), so rendering
                  // it here directly would show $0 and let it be added with no size chosen at
                  // all. Route to that flow instead of adding straight from the card.
                  categoryId === 'calzones' ? (
                    <SizedProductLink key={`${categoryId}-${product.id}`} product={product} />
                  ) : (
                    <ProductCard
                      key={`${categoryId}-${product.id}`}
                      categoryId={categoryId}
                      product={product}
                      pizzaFlavors={flavors}
                      excludedFlavorIds={promoDraft?.type === 'duo' && categoryId === 'gratinados' ? DUO_EXCLUDED_FLAVORS : undefined}
                    />
                  )
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** Like SizedProductLink, but for the whole pizza category - no single price to show until size+flavors are picked. */
function PizzaCategoryLink({ matchedFlavorNames }: { matchedFlavorNames: string[] }) {
  const Icon = categoryIcon('pizzas');

  return (
    <Link
      to="/menu/pizzas"
      className="anim-scale-in flex cursor-pointer flex-col gap-2 rounded-2xl border border-border bg-surface p-4 shadow-sm transition-colors duration-fast hover:border-brand-400"
    >
      <div className="flex items-start gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600">
          <Icon size={18} />
        </span>
        <div>
          <h3 className="font-semibold text-text-primary">Pizza</h3>
          <p className="mt-0.5 text-sm text-text-secondary">
            {matchedFlavorNames.length > 0 ? `Coincide: ${matchedFlavorNames.join(', ')}` : 'Elige el tamaño y los sabores'}
          </p>
        </div>
      </div>
      <span className="mt-1 flex items-center justify-center rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600">
        Elegir tamaño
      </span>
    </Link>
  );
}

/** Card shell matches ProductCard's, but for a product priced per size (only calzone today) - clicking it goes to /menu/calzone's size picker instead of adding straight to the cart, since there's no size to snapshot a price from here. */
function SizedProductLink({ product }: { product: Product }) {
  const Icon = categoryIcon('calzones');
  const sizes = product.sizes ?? [];
  const fromPrice = Math.min(...sizes.map((s) => s.price));

  return (
    <Link
      to="/menu/calzone"
      className="anim-scale-in flex cursor-pointer flex-col gap-2 rounded-2xl border border-border bg-surface p-4 shadow-sm transition-colors duration-fast hover:border-brand-400"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600">
            <Icon size={18} />
          </span>
          <div>
            <h3 className="font-semibold text-text-primary">{product.name}</h3>
            <p className="mt-0.5 text-sm text-text-secondary">{sizes.map((s) => `${s.name} ${formatCOP(s.price)}`).join(' · ')}</p>
          </div>
        </div>
        <span className="shrink-0 whitespace-nowrap font-semibold text-brand-700">Desde {formatCOP(fromPrice)}</span>
      </div>
      <span className="mt-1 flex items-center justify-center rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600">
        Elegir tamaño
      </span>
    </Link>
  );
}
