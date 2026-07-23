import { useState } from 'react';
import classNames from 'classnames';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { MessageSquarePlus, Plus } from 'lucide-react';
import { useMenu } from '@/lib/queries';
import { allPizzaFlavors, getPizzaCategory, getProductCategory, productUnitPrice } from '@/lib/pricing';
import { formatCOP } from '@/lib/format';
import { useOrderStore } from '@/store/useOrderStore';
import { useToastStore } from '@/store/useToastStore';

export const Route = createFileRoute('/menu/calzone/$size')({
  component: CalzoneFlavorPage,
});

function CalzoneFlavorPage() {
  const { size: sizeId } = Route.useParams();
  const { data: menu, isLoading } = useMenu();
  const navigate = useNavigate();

  const [flavorId, setFlavorId] = useState('');
  const [showComment, setShowComment] = useState(false);
  const [notes, setNotes] = useState('');

  const currentOrderId = useOrderStore((s) => s.currentOrderId);
  const newOrderInfo = useOrderStore((s) => s.newOrderInfo);
  const addCartItem = useOrderStore((s) => s.addCartItem);
  const pushToast = useToastStore((s) => s.push);

  if (isLoading || !menu) return <p className="text-sm text-text-secondary">Cargando...</p>;

  const category = getProductCategory(menu, 'calzones');
  const product = category?.products.find((p) => p.sizes && p.sizes.length > 0);
  const size = product?.sizes?.find((s) => s.id === sizeId);
  const pizzas = getPizzaCategory(menu);
  if (!category || !product || !size || !pizzas) return <p className="text-sm text-text-secondary">No encontrado.</p>;

  const flavors = allPizzaFlavors(pizzas);
  const price = productUnitPrice(product, sizeId);
  const hasOrderContext = currentOrderId != null || newOrderInfo != null;

  const handleAdd = () => {
    if (!hasOrderContext) {
      pushToast('Primero elige una mesa, domicilio o para llevar', 'warning');
      return;
    }
    if (!flavorId) {
      pushToast('Elige un sabor', 'warning');
      return;
    }

    const flavorName = flavors.find((f) => f.id === flavorId)?.name ?? '';

    addCartItem({
      clientId: crypto.randomUUID(),
      request: {
        type: 'product',
        category: 'calzones',
        product: product.id,
        size: sizeId,
        pizzaFlavor: flavorId,
        quantity: 1,
        notes: notes.trim() || undefined,
      },
      label: `${product.name} ${size.name} - ${flavorName}`,
      unitPrice: price,
      quantity: 1,
    });

    pushToast(`${product.name} agregado`);
    navigate({ to: '/menu/calzone' });
  };

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-text-primary">
        Sabor para {product.name} {size.name}
      </h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {flavors.map((flavor) => (
          <button
            key={flavor.id}
            type="button"
            onClick={() => setFlavorId(flavor.id)}
            className={classNames(
              'rounded-xl border-2 p-3 text-left transition-colors duration-fast',
              flavorId === flavor.id ? 'border-brand-500 bg-brand-500/10' : 'border-border bg-surface hover:border-brand-300',
            )}
          >
            <p className="text-sm font-semibold text-text-primary">{flavor.name}</p>
            <p className="mt-0.5 text-xs text-text-secondary">{flavor.description}</p>
          </button>
        ))}
      </div>

      {showComment && (
        <textarea
          autoFocus
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Nota, ej. bien cocido"
          rows={2}
          className="mt-4 w-full max-w-md resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
        />
      )}

      <div className="mt-6 flex items-center gap-3">
        <span className="text-lg font-semibold text-brand-700">{formatCOP(price)}</span>
        <button
          type="button"
          onClick={handleAdd}
          className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600"
        >
          <Plus size={16} /> Agregar a la orden
        </button>
        <button
          type="button"
          onClick={() => setShowComment((v) => !v)}
          aria-label="Agregar comentario"
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
        >
          <MessageSquarePlus size={16} />
        </button>
      </div>
    </div>
  );
}
