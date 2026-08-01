import { useState } from 'react';
import classNames from 'classnames';
import { MessageSquarePlus, Plus } from 'lucide-react';
import type { PizzaFlavor, Product, ProductCategoryId } from '@/types/api';
import { formatCOP } from '@/lib/format';
import { productUnitPrice } from '@/lib/pricing';
import { useOrderStore } from '@/store/useOrderStore';
import { useToastStore } from '@/store/useToastStore';
import { usePromoSettings } from '@/lib/queries';
import { promoProgressText } from '@/lib/promos';
import { categoryIcon } from '@/lib/menuIcons';
import { randomUUID } from '@/lib/uuid';

interface ProductCardProps {
  categoryId: ProductCategoryId;
  product: Product;
  /** All pizza flavors, only needed for products with `pizzaFlavor: true` (e.g. gratin). */
  pizzaFlavors: PizzaFlavor[];
  /** Flavor ids to hide from the picker, e.g. the 5 flavors the 'duo' promo excludes from gratinados. */
  excludedFlavorIds?: Set<string>;
}

export function ProductCard({ categoryId, product, pizzaFlavors, excludedFlavorIds }: ProductCardProps) {
  const availableFlavors = excludedFlavorIds ? pizzaFlavors.filter((f) => !excludedFlavorIds.has(f.id)) : pizzaFlavors;
  const [drinkFlavorId, setDrinkFlavorId] = useState(product.drinkFlavors?.[0]?.id ?? '');
  const [flavorId, setFlavorId] = useState(availableFlavors.find((f) => f.isAvailable)?.id ?? availableFlavors[0]?.id ?? '');
  const [showComment, setShowComment] = useState(false);
  const [notes, setNotes] = useState('');

  const addCartItem = useOrderStore((s) => s.addCartItem);
  const promoDraft = useOrderStore((s) => s.promoDraft);
  const addPromoItem = useOrderStore((s) => s.addPromoItem);
  const pushToast = useToastStore((s) => s.push);
  const { data: promoSettings = [] } = usePromoSettings();

  const price = productUnitPrice(product);

  const handleAdd = () => {
    if (!product.isAvailable) {
      pushToast('Este producto está agotado', 'warning');
      return;
    }
    if (product.drinkFlavors && !drinkFlavorId) {
      pushToast('Elige un sabor', 'warning');
      return;
    }
    if (product.pizzaFlavor && !flavorId) {
      pushToast('Elige un sabor', 'warning');
      return;
    }
    if (product.pizzaFlavor && availableFlavors.find((f) => f.id === flavorId)?.isAvailable === false) {
      pushToast('Ese sabor está agotado', 'warning');
      return;
    }

    const drinkFlavor = product.drinkFlavors?.find((f) => f.id === drinkFlavorId);
    // `flavorId` defaults to the first pizza flavor (Napolitana) regardless of
    // product type - only meaningful (and only rendered as a picker) when the
    // product actually requires one (gratinados etc.), so gate both the label
    // and the request on product.pizzaFlavor instead of using it unconditionally,
    // which was tacking "- Napolitana" onto every product including drinks.
    const flavor = product.pizzaFlavor ? availableFlavors.find((f) => f.id === flavorId) : undefined;
    const labelParts = [product.name, drinkFlavor?.name, flavor?.name].filter(Boolean);

    const item = {
      clientId: randomUUID(),
      request: {
        type: 'product' as const,
        category: categoryId,
        product: product.id,
        drinkFlavor: drinkFlavorId || undefined,
        pizzaFlavor: product.pizzaFlavor ? (flavorId || undefined) : undefined,
        quantity: 1,
        notes: notes.trim() || undefined,
      },
      label: labelParts.join(' - '),
      unitPrice: price,
      quantity: 1,
    };

    if (promoDraft) {
      const settings = promoSettings.find((s) => s.promoType === promoDraft.type);
      if (!settings) {
        pushToast('No se pudo cargar el precio de la promoción, intenta de nuevo', 'error');
        return;
      }
      addPromoItem(item, settings);
      pushToast(promoProgressText(promoDraft.type, promoDraft.items.length + 1, settings));
      setNotes('');
      setShowComment(false);
      return;
    }

    addCartItem(item);
    pushToast(`${product.name} agregado`);
    setNotes('');
    setShowComment(false);
  };

  const Icon = categoryIcon(categoryId);

  const disabled = !product.isAvailable;

  return (
    <div
      className={classNames(
        'anim-scale-in flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 shadow-sm',
        disabled && 'opacity-60 grayscale-[0.4]'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600">
            <Icon size={18} />
          </span>
          <div>
            <h3 className="font-semibold text-text-primary">{product.name}</h3>
            {product.description && <p className="mt-0.5 text-sm text-text-secondary">{product.description}</p>}
          </div>
        </div>
        {disabled ? (
          <span className="shrink-0 whitespace-nowrap rounded-full bg-danger-bg px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-danger">Agotado</span>
        ) : (
          <span className="shrink-0 whitespace-nowrap font-semibold text-brand-700">{promoDraft ? 'Promo' : formatCOP(price)}</span>
        )}
      </div>

      {product.drinkFlavors && product.drinkFlavors.length > 0 && (
        <select
          value={drinkFlavorId}
          onChange={(e) => setDrinkFlavorId(e.target.value)}
          disabled={disabled}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-400 disabled:cursor-not-allowed"
        >
          {product.drinkFlavors.map((flavor) => (
            <option key={flavor.id} value={flavor.id}>
              {flavor.name}
            </option>
          ))}
        </select>
      )}

      {product.pizzaFlavor && (
        <select
          value={flavorId}
          onChange={(e) => setFlavorId(e.target.value)}
          disabled={disabled}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-400 disabled:cursor-not-allowed"
        >
          {availableFlavors.map((flavor) => (
            <option key={flavor.id} value={flavor.id} disabled={!flavor.isAvailable}>
              {flavor.isAvailable ? flavor.name : `${flavor.name} (Agotado)`}
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
          disabled={disabled}
          className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-border disabled:text-text-secondary disabled:hover:bg-border"
        >
          <Plus size={16} /> {disabled ? 'Agotado' : 'Agregar'}
        </button>
        <button
          type="button"
          onClick={() => setShowComment((v) => !v)}
          disabled={disabled}
          aria-label="Agregar comentario"
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-border text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <MessageSquarePlus size={16} />
        </button>
      </div>
    </div>
  );
}
