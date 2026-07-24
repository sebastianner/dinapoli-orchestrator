import { useState } from 'react';
import classNames from 'classnames';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { MessageSquarePlus, Plus } from 'lucide-react';
import { useMenu } from '@/lib/queries';
import {
  allPizzaFlavors,
  computeFlavorPortions,
  formatPortionFraction,
  getPizzaCategory,
  maxFlavorsFor,
  orderablePizzaSizes,
  pizzaUnitPrice,
  splitPatternsFor,
  type FlavorSplitPattern,
} from '@/lib/pricing';
import { formatCOP } from '@/lib/format';
import { useOrderStore } from '@/store/useOrderStore';
import { useToastStore } from '@/store/useToastStore';
import type { PizzaSizeId } from '@/types/api';

export const Route = createFileRoute('/menu/pizzas/$size')({
  component: PizzaFlavorPage,
});

/**
 * The actual submitted portion for an 'equal' split gives the remainder (e.g.
 * 34/33/33 for thirds) to one flavor so it sums to exactly 100 - correct for
 * pricing, but confusing to read on a tile. Round every tile down evenly for
 * display only; the 'half' pattern's 50/25/25 is already exact either way.
 */
function displayPortion(portion: number, count: number, pattern: FlavorSplitPattern): number {
  const isHalfPattern = pattern === 'half' && count === 3;
  return isHalfPattern ? portion : Math.floor(100 / count);
}

function PizzaFlavorPage() {
  const { size: sizeId } = Route.useParams();
  const { data: menu, isLoading } = useMenu();
  const navigate = useNavigate();

  const [selectedFlavors, setSelectedFlavors] = useState<string[]>([]);
  const [pattern, setPattern] = useState<FlavorSplitPattern>('equal');
  const [halfFlavorId, setHalfFlavorId] = useState<string | null>(null);
  const [showComment, setShowComment] = useState(false);
  const [notes, setNotes] = useState('');

  const currentOrderId = useOrderStore((s) => s.currentOrderId);
  const newOrderInfo = useOrderStore((s) => s.newOrderInfo);
  const addCartItem = useOrderStore((s) => s.addCartItem);
  const pushToast = useToastStore((s) => s.push);

  if (isLoading || !menu) return <p className="text-sm text-text-secondary">Cargando...</p>;

  const pizzas = getPizzaCategory(menu);
  if (!pizzas) return <p className="text-sm text-text-secondary">Pizzas no disponibles.</p>;

  const size = orderablePizzaSizes(pizzas).find((s) => s.id === sizeId);
  if (!size) return <p className="text-sm text-text-secondary">Tamaño no encontrado.</p>;

  const flavors = allPizzaFlavors(pizzas);
  const maxFlavors = maxFlavorsFor(pizzas, sizeId);
  const price = pizzaUnitPrice(pizzas, sizeId, selectedFlavors);
  const hasOrderContext = currentOrderId != null || newOrderInfo != null;
  const availablePatterns = splitPatternsFor(selectedFlavors.length);
  const portions = computeFlavorPortions(selectedFlavors, pattern, halfFlavorId ?? undefined);

  const toggleFlavor = (flavorId: string) => {
    setSelectedFlavors((prev) => {
      const next = prev.includes(flavorId)
        ? prev.filter((id) => id !== flavorId)
        : prev.length >= maxFlavors
          ? maxFlavors === 1
            ? [flavorId]
            : prev
          : [...prev, flavorId];
      if (next.length !== 3) {
        setPattern('equal');
        setHalfFlavorId(null);
      }
      return next;
    });
  };

  const handleAdd = () => {
    if (!hasOrderContext) {
      pushToast('Primero elige una mesa, domicilio o para llevar', 'warning');
      return;
    }
    if (selectedFlavors.length === 0) {
      pushToast('Elige al menos un sabor', 'warning');
      return;
    }

    const flavorNames = portions.map(({ flavor: flavorId, portion }) => {
      const name = flavors.find((f) => f.id === flavorId)?.name ?? flavorId;
      const fraction = formatPortionFraction(portion);
      return fraction ? `${name} (${fraction})` : name;
    });

    addCartItem({
      clientId: crypto.randomUUID(),
      request: {
        type: 'pizza',
        size: sizeId as PizzaSizeId,
        flavors: portions,
        quantity: 1,
        notes: notes.trim() || undefined,
      },
      label: `Pizza ${size.name} - ${flavorNames.join(', ')}`,
      unitPrice: price,
      quantity: 1,
    });

    pushToast('Pizza agregada');
    navigate({ to: '/menu/pizzas' });
  };

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-text-primary">
        Sabores para pizza {size.name} <span className="font-normal text-text-secondary">(máx. {maxFlavors})</span>
      </h1>
      <p className="mb-4 text-sm text-text-secondary">
        Seleccionados: {selectedFlavors.length}/{maxFlavors}
      </p>

      <div className="flex flex-col gap-6">
        {pizzas.groups.map((group) => (
          <div key={group.id}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-secondary">{group.name}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {group.flavors.map((flavor) => {
                const isSelected = selectedFlavors.includes(flavor.id);
                const portion = portions.find((p) => p.flavor === flavor.id)?.portion;
                return (
                  <button
                    key={flavor.id}
                    type="button"
                    onClick={() => toggleFlavor(flavor.id)}
                    className={classNames(
                      'relative rounded-xl border-2 p-3 text-left transition-colors duration-fast',
                      isSelected ? 'border-brand-500 bg-brand-500/10' : 'border-border bg-surface hover:border-brand-300',
                    )}
                  >
                    {isSelected && selectedFlavors.length > 1 && portion != null && (
                      <span className="absolute right-2 top-2 rounded-full bg-brand-500 px-1.5 py-0.5 text-xs font-bold text-white">
                        {displayPortion(portion, selectedFlavors.length, pattern)}%
                      </span>
                    )}
                    <p className="text-sm font-semibold text-text-primary">{flavor.name}</p>
                    <p className="mt-0.5 text-xs text-text-secondary">{flavor.description}</p>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {availablePatterns.length > 1 && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold text-text-primary">¿Cómo se reparte?</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPattern('equal')}
              className={classNames(
                'rounded-full border-2 px-3 py-1.5 text-xs font-semibold transition-colors duration-fast',
                pattern === 'equal' ? 'border-brand-500 bg-brand-500/10 text-brand-700' : 'border-border text-text-secondary hover:border-brand-300',
              )}
            >
              Partes iguales (33/33/33)
            </button>
            <button
              type="button"
              onClick={() => setPattern('half')}
              className={classNames(
                'rounded-full border-2 px-3 py-1.5 text-xs font-semibold transition-colors duration-fast',
                pattern === 'half' ? 'border-brand-500 bg-brand-500/10 text-brand-700' : 'border-border text-text-secondary hover:border-brand-300',
              )}
            >
              Mitad y mitad (50/25/25)
            </button>
          </div>

          {pattern === 'half' && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-text-secondary">¿Cuál va a la mitad?</span>
              {selectedFlavors.map((flavorId) => {
                const name = flavors.find((f) => f.id === flavorId)?.name ?? flavorId;
                const isHalf = (halfFlavorId ?? selectedFlavors[0]) === flavorId;
                return (
                  <button
                    key={flavorId}
                    type="button"
                    onClick={() => setHalfFlavorId(flavorId)}
                    className={classNames(
                      'rounded-full border-2 px-3 py-1 text-xs font-semibold transition-colors duration-fast',
                      isHalf ? 'border-brand-500 bg-brand-500/10 text-brand-700' : 'border-border text-text-secondary hover:border-brand-300',
                    )}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showComment && (
        <textarea
          autoFocus
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Nota, ej. bien cocida"
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
