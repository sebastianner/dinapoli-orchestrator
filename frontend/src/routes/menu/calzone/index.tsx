import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMenu } from '@/lib/queries';
import { getProductCategory } from '@/lib/pricing';
import { formatCOP } from '@/lib/format';

export const Route = createFileRoute('/menu/calzone/')({
  component: CalzoneSizePage,
});

function CalzoneSizePage() {
  const { data: menu, isLoading } = useMenu();
  const navigate = useNavigate();

  if (isLoading || !menu) return <p className="text-sm text-text-secondary">Cargando...</p>;

  const category = getProductCategory(menu, 'calzones');
  const product = category?.products.find((p) => p.sizes && p.sizes.length > 0);
  if (!category || !product) return <p className="text-sm text-text-secondary">Pantalón no disponible.</p>;

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-text-primary">Elige el tamaño del {product.name}</h1>
      <div className="flex flex-wrap gap-4">
        {product.sizes!.map((size) => (
          <button
            key={size.id}
            type="button"
            onClick={() => navigate({ to: '/menu/calzone/$size', params: { size: size.id } })}
            className="anim-scale-in flex w-36 flex-col items-center gap-1 rounded-2xl border border-border bg-surface p-5 shadow-sm transition-transform duration-fast hover:scale-105 hover:border-brand-400 active:scale-95"
          >
            <span className="text-lg font-semibold text-text-primary">{size.name}</span>
            <span className="mt-1 font-semibold text-brand-700">{formatCOP(size.price)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
