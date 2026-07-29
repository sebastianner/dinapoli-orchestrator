import { useEffect, useState } from 'react';
import { mutate } from 'swr';
import { X } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { useDrinkFlavors } from '@/lib/queries';
import { updateProductDrinkFlavors } from '@/lib/api';
import { useToastStore } from '@/store/useToastStore';
import type { AdminProduct } from '@/types/api';

interface DrinkFlavorsModalProps {
  product: AdminProduct | null;
  onClose: () => void;
}

/**
 * Sets the exact set of drink flavors a product offers (0 to many) - select
 * an existing flavor from the shared library (autocomplete), type a new one
 * to create it on save, or remove one already attached. See
 * menuService.setProductDrinkFlavors - it find-or-creates each name, so
 * typing "Coca-Cola" here resolves to the same row another product already
 * uses instead of creating a duplicate.
 */
export function DrinkFlavorsModal({ product, onClose }: DrinkFlavorsModalProps) {
  const { data: allFlavors = [] } = useDrinkFlavors();
  const [selected, setSelected] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    if (!product) return;
    setSelected(product.drinkFlavors.map((f) => f.name));
    setInput('');
    setError(null);
  }, [product]);

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const addFlavor = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (selected.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      setInput('');
      return;
    }
    setSelected((prev) => [...prev, trimmed]);
    setInput('');
  };

  const removeFlavor = (name: string) => setSelected((prev) => prev.filter((s) => s !== name));

  const trimmedInput = input.trim();
  const suggestions = trimmedInput
    ? allFlavors.filter(
        (f) => f.name.toLowerCase().includes(trimmedInput.toLowerCase()) && !selected.some((s) => s.toLowerCase() === f.name.toLowerCase())
      )
    : [];
  const isNewName = trimmedInput !== '' && !allFlavors.some((f) => f.name.toLowerCase() === trimmedInput.toLowerCase());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;

    setSubmitting(true);
    setError(null);
    try {
      await updateProductDrinkFlavors(product.id, selected);
      await mutate('/products');
      await mutate('/products/drink-flavors');
      pushToast(`Sabores de ${product.name} actualizados`);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={product != null} onClose={handleClose} title={product ? `Sabores - ${product.name}` : ''}>
      {product && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {selected.length === 0 && (
              <p className="text-sm text-text-secondary">Sin sabores - este producto se agregará al pedido sin pedir elegir uno.</p>
            )}
            {selected.map((name) => (
              <span
                key={name}
                className="flex items-center gap-1.5 rounded-full border border-brand-500 bg-brand-500/10 px-3 py-1.5 text-sm font-medium text-brand-700"
              >
                {name}
                <button
                  type="button"
                  onClick={() => removeFlavor(name)}
                  aria-label={`Quitar ${name}`}
                  className="cursor-pointer text-brand-600 hover:text-danger"
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>

          <div className="relative">
            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addFlavor(input);
                }
              }}
              placeholder="Buscar o agregar un sabor…"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
            />
            {(suggestions.length > 0 || isNewName) && (
              <div className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
                {suggestions.map((flavor) => (
                  <button
                    key={flavor.id}
                    type="button"
                    onClick={() => addFlavor(flavor.name)}
                    className="flex w-full cursor-pointer items-center px-3 py-2 text-left text-sm text-text-primary hover:bg-brand-500/10"
                  >
                    {flavor.name}
                  </button>
                ))}
                {isNewName && (
                  <button
                    type="button"
                    onClick={() => addFlavor(trimmedInput)}
                    className="flex w-full cursor-pointer items-center px-3 py-2 text-left text-sm font-semibold text-brand-600 hover:bg-brand-500/10"
                  >
                    + Crear "{trimmedInput}"
                  </button>
                )}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full cursor-pointer rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-60"
          >
            {submitting ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </form>
      )}
    </Modal>
  );
}
