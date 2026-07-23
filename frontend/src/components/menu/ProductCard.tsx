import { useState } from 'react';
import { MessageSquarePlus, Plus } from 'lucide-react';
import type { PizzaFlavor, Product, ProductCategoryId } from '@/types/api';
import { formatCOP } from '@/lib/format';
import { productUnitPrice } from '@/lib/pricing';
import { useOrderStore } from '@/store/useOrderStore';
import { useToastStore } from '@/store/useToastStore';

interface ProductCardProps {
  categoryId: ProductCategoryId;
  product: Product;
  /** All pizza flavors, only needed for products with `pizzaFlavor: true` (e.g. gratin). */
  pizzaFlavors: PizzaFlavor[];
}

export function ProductCard({ categoryId, product, pizzaFlavors }: ProductCardProps) {
  const [optionId, setOptionId] = useState(product.options?.[0]?.id ?? '');
  const [flavorId, setFlavorId] = useState(pizzaFlavors[0]?.id ?? '');
  const [showComment, setShowComment] = useState(false);
  const [notes, setNotes] = useState('');

  const currentOrderId = useOrderStore((s) => s.currentOrderId);
  const newOrderInfo = useOrderStore((s) => s.newOrderInfo);
  const addCartItem = useOrderStore((s) => s.addCartItem);
  const pushToast = useToastStore((s) => s.push);

  const hasOrderContext = currentOrderId != null || newOrderInfo != null;
  const price = productUnitPrice(product);

  const handleAdd = () => {
    if (!hasOrderContext) {
      pushToast('Primero elige una mesa, domicilio o para llevar', 'warning');
      return;
    }
    if (product.options && !optionId) {
      pushToast('Elige una opción', 'warning');
      return;
    }
    if (product.pizzaFlavor && !flavorId) {
      pushToast('Elige un sabor', 'warning');
      return;
    }

    const option = product.options?.find((o) => o.id === optionId);
    const flavor = pizzaFlavors.find((f) => f.id === flavorId);
    const labelParts = [product.name, option?.name, flavor?.name].filter(Boolean);

    addCartItem({
      clientId: crypto.randomUUID(),
      request: {
        type: 'product',
        category: categoryId,
        product: product.id,
        option: optionId || undefined,
        pizzaFlavor: flavorId || undefined,
        quantity: 1,
        notes: notes.trim() || undefined,
      },
      label: labelParts.join(' - '),
      unitPrice: price,
      quantity: 1,
    });

    pushToast(`${product.name} agregado`);
    setNotes('');
    setShowComment(false);
  };

  return (
    <div className="anim-scale-in flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-text-primary">{product.name}</h3>
          {product.description && <p className="mt-0.5 text-sm text-text-secondary">{product.description}</p>}
        </div>
        <span className="shrink-0 whitespace-nowrap font-semibold text-brand-700">{formatCOP(price)}</span>
      </div>

      {product.options && product.options.length > 0 && (
        <select
          value={optionId}
          onChange={(e) => setOptionId(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-400"
        >
          {product.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      )}

      {product.pizzaFlavor && (
        <select
          value={flavorId}
          onChange={(e) => setFlavorId(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-400"
        >
          {pizzaFlavors.map((flavor) => (
            <option key={flavor.id} value={flavor.id}>
              {flavor.name}
            </option>
          ))}
        </select>
      )}

      {showComment && (
        <textarea
          autoFocus
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Nota, ej. sin cebolla"
          rows={2}
          className="resize-none rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-400"
        />
      )}

      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={handleAdd}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600"
        >
          <Plus size={16} /> Agregar
        </button>
        <button
          type="button"
          onClick={() => setShowComment((v) => !v)}
          aria-label="Agregar comentario"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
        >
          <MessageSquarePlus size={16} />
        </button>
      </div>
    </div>
  );
}
