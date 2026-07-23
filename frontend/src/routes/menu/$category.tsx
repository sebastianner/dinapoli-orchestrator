import { createFileRoute, redirect } from '@tanstack/react-router';
import { useMenu } from '@/lib/queries';
import { allPizzaFlavors, getPizzaCategory, getProductCategory } from '@/lib/pricing';
import { ProductCard } from '@/components/menu/ProductCard';
import type { ProductCategoryId } from '@/types/api';

export const Route = createFileRoute('/menu/$category')({
  beforeLoad: ({ params }) => {
    // Pizzas and calzones need the dedicated size/flavor flow (see /menu/pizzas, /menu/calzone).
    if (params.category === 'pizzas') throw redirect({ to: '/menu/pizzas' });
    if (params.category === 'calzones') throw redirect({ to: '/menu/calzone' });
  },
  component: MenuCategoryPage,
});

function MenuCategoryPage() {
  const { category } = Route.useParams();
  const { data: menu, isLoading } = useMenu();

  if (isLoading || !menu) return <p className="text-sm text-text-secondary">Cargando...</p>;

  const productCategory = getProductCategory(menu, category as ProductCategoryId);
  if (!productCategory) return <p className="text-sm text-text-secondary">Categoría no encontrada.</p>;

  const pizzaCategory = getPizzaCategory(menu);
  const flavors = pizzaCategory ? allPizzaFlavors(pizzaCategory) : [];

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-text-primary">{productCategory.name}</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {productCategory.products.map((product) => (
          <ProductCard key={product.id} categoryId={productCategory.id} product={product} pizzaFlavors={flavors} />
        ))}
      </div>
    </div>
  );
}
