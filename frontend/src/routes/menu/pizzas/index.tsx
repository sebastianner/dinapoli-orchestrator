import { useEffect } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMenu } from '@/lib/queries';
import { getPizzaCategory, orderablePizzaSizes } from '@/lib/pricing';
import { useOrderStore } from '@/store/useOrderStore';
import { PROMO_ALLOWED_SIZES } from '@/lib/promos';

export const Route = createFileRoute('/menu/pizzas/')({
  component: PizzaSizePage,
});

function PizzaSizePage() {
  const { data: menu, isLoading } = useMenu();
  const navigate = useNavigate();
  const promoDraft = useOrderStore((s) => s.promoDraft);

  const pizzas = menu ? getPizzaCategory(menu) : undefined;
  const allSizes = pizzas ? orderablePizzaSizes(pizzas) : [];
  const sizes = promoDraft ? allSizes.filter((s) => PROMO_ALLOWED_SIZES[promoDraft.type].has(s.id)) : allSizes;

  // The promo only ever leaves exactly one size selectable - skip straight to
  // the flavor picker instead of making the user pick a foregone conclusion.
  const onlySizeId = sizes.length === 1 ? sizes[0].id : null;
  useEffect(() => {
    if (onlySizeId) {
      navigate({ to: '/menu/pizzas/$size', params: { size: onlySizeId }, replace: true });
    }
  }, [navigate, onlySizeId]);

  if (isLoading || !menu) return <p className="text-sm text-text-secondary">Cargando...</p>;
  if (!pizzas) return <p className="text-sm text-text-secondary">Pizzas no disponibles.</p>;

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-text-primary">Elige el tamaño de la pizza</h1>
      <div className="flex flex-wrap gap-4">
        {sizes.map((size) => (
          <button
            key={size.id}
            type="button"
            onClick={() => navigate({ to: '/menu/pizzas/$size', params: { size: size.id } })}
            className="anim-scale-in flex w-36 cursor-pointer flex-col items-center gap-1 rounded-2xl border border-border bg-surface p-5 shadow-sm transition-transform duration-fast hover:scale-105 hover:border-brand-400 active:scale-95"
          >
            <span className="text-lg font-semibold text-text-primary">{size.name}</span>
            <span className="text-xs text-text-secondary">Sabores: {size.maxFlavors}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
