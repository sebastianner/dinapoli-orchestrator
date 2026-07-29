import { useEffect, useState } from 'react';
import { mutate } from 'swr';
import { Martini, Trash2 } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { updateAdminProduct, updateAdminProductSize } from '@/lib/api';
import { useToastStore } from '@/store/useToastStore';
import type { AdminProduct } from '@/types/api';

interface EditProductModalProps {
  product: AdminProduct | null;
  onClose: () => void;
  /** Hands off to DeleteProductModal instead of deleting inline, so there's one delete flow/confirmation for the whole page (see menu-settings/index.tsx). */
  onRequestDelete: (product: AdminProduct) => void;
  /** Hands off to DrinkFlavorsModal - only rendered for drinks, same "one flow, not two" reasoning as onRequestDelete. */
  onRequestFlavors: (product: AdminProduct) => void;
}

/** Edit surface for a single product (price + availability). Below the `lg` breakpoint, ProductSettingsRow's inline controls are replaced by a read-only row that opens this instead, since there's no longer room to cram price/toggle/delete into one line without the name collapsing. Products priced per size (e.g. calzone) also open this on desktop, since ProductSettingsRow has no room for one price input per size either. */
export function EditProductModal({ product, onClose, onRequestDelete, onRequestFlavors }: EditProductModalProps) {
  const [priceInput, setPriceInput] = useState('');
  const [sizeInputs, setSizeInputs] = useState<Record<string, string>>({});
  const [isAvailable, setIsAvailable] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    if (!product) return;
    setPriceInput(product.price != null ? String(product.price) : '');
    setSizeInputs(Object.fromEntries(product.sizes.map((s) => [s.id, String(s.price)])));
    setIsAvailable(product.isAvailable);
    setError(null);
  }, [product]);

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;

    const input: { price?: number; isAvailable?: boolean } = {};
    if (product.price != null) {
      const parsed = Number(priceInput);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setError('El precio debe ser un número entero mayor a 0');
        return;
      }
      if (parsed !== product.price) input.price = parsed;
    }
    if (isAvailable !== product.isAvailable) input.isAvailable = isAvailable;

    const changedSizes: { id: string; price: number }[] = [];
    for (const size of product.sizes) {
      const parsed = Number(sizeInputs[size.id]);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setError('El precio debe ser un número entero mayor a 0');
        return;
      }
      if (parsed !== size.price) changedSizes.push({ id: size.id, price: parsed });
    }

    if (Object.keys(input).length === 0 && changedSizes.length === 0) {
      handleClose();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      if (Object.keys(input).length > 0) await updateAdminProduct(product.id, input);
      for (const size of changedSizes) await updateAdminProductSize(product.id, size.id, size.price);
      await mutate('/products');
      pushToast(`${product.name} actualizado`);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={product != null} onClose={handleClose} title={product ? product.name : ''}>
      {product && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {product.price != null ? (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-secondary">Precio</span>
              <input
                autoFocus
                type="number"
                min={1}
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
              />
            </label>
          ) : (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-text-secondary">Precio por tamaño</span>
              {product.sizes.map((size, i) => (
                <label key={size.id} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-text-primary">{size.name}</span>
                  <input
                    autoFocus={i === 0}
                    type="number"
                    min={1}
                    value={sizeInputs[size.id] ?? ''}
                    onChange={(e) => setSizeInputs((prev) => ({ ...prev, [size.id]: e.target.value }))}
                    className="w-28 rounded-lg border border-border bg-surface px-3 py-2 text-right text-sm text-text-primary outline-none focus:border-brand-400"
                  />
                </label>
              ))}
            </div>
          )}

          <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm font-medium text-text-primary">Disponible</span>
            <button
              type="button"
              role="switch"
              aria-checked={isAvailable}
              onClick={() => setIsAvailable((v) => !v)}
              className={`relative h-6 w-10 shrink-0 rounded-full transition-colors duration-fast ${isAvailable ? 'bg-success' : 'bg-border'}`}
            >
              {/* left-0 pins the knob's static position to the track's left edge - without it, the
                  button's default `text-align: center` skews the absolutely-positioned span's base
                  position before `translate-x` is even applied, causing it to overflow the track. */}
              <span
                className={`absolute top-0.5 left-0 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-fast ${isAvailable ? 'translate-x-[1.125rem]' : 'translate-x-0.5'}`}
              />
            </button>
          </label>

          {product.categoryId === 'drinks' && (
            <button
              type="button"
              onClick={() => {
                handleClose();
                onRequestFlavors(product);
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2.5 text-sm font-semibold text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
            >
              <Martini size={15} />
              {product.drinkFlavors.length > 0
                ? `Sabores (${product.drinkFlavors.length})`
                : 'Agregar sabores'}
            </button>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-60"
          >
            {submitting ? 'Guardando...' : 'Guardar cambios'}
          </button>

          <button
            type="button"
            onClick={() => {
              handleClose();
              onRequestDelete(product);
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-danger/40 py-2.5 text-sm font-semibold text-danger transition-colors duration-fast hover:bg-danger/10"
          >
            <Trash2 size={15} /> Eliminar producto
          </button>
        </form>
      )}
    </Modal>
  );
}
