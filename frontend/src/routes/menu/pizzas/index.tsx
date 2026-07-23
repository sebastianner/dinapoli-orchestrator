import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMenu } from '@/lib/queries';
import { getPizzaCategory, orderablePizzaSizes } from '@/lib/pricing';

export const Route = createFileRoute('/menu/pizzas/')({
  component: PizzaSizePage,
});

function PizzaSizePage() {
  const { data: menu, isLoading } = useMenu();
  const navigate = useNavigate();

  if (isLoading || !menu) return <p className="text-sm text-text-secondary">Cargando...</p>;

  const pizzas = getPizzaCategory(menu);
  if (!pizzas) return <p className="text-sm text-text-secondary">Pizzas no disponibles.</p>;

  const sizes = orderablePizzaSizes(pizzas);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-text-primary">Elige el tamaño de la pizza</h1>
      <div className="flex flex-wrap gap-4">
        {sizes.map((size) => (
          <button
            key={size.id}
            type="button"
            onClick={() => navigate({ to: '/menu/pizzas/$size', params: { size: size.id } })}
            className="anim-scale-in flex w-36 flex-col items-center gap-1 rounded-2xl border border-border bg-surface p-5 shadow-sm transition-transform duration-fast hover:scale-105 hover:border-brand-400 active:scale-95"
          >
            <span className="text-lg font-semibold text-text-primary">{size.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
