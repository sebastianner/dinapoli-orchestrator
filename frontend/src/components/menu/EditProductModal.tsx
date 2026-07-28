import { useEffect, useState } from 'react';
import { mutate } from 'swr';
import { Trash2 } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { updateAdminProduct } from '@/lib/api';
import { formatCOP } from '@/lib/format';
import { useToastStore } from '@/store/useToastStore';
import type { AdminProduct } from '@/types/api';

interface EditProductModalProps {
  product: AdminProduct | null;
  onClose: () => void;
  /** Hands off to DeleteProductModal instead of deleting inline, so there's one delete flow/confirmation for the whole page (see menu-settings/index.tsx). */
  onRequestDelete: (product: AdminProduct) => void;
}

/** Mobile/tablet edit surface for a single product (price + availability) - below the `lg` breakpoint, ProductSettingsRow's inline controls are replaced by a read-only row that opens this instead, since there's no longer room to cram price/toggle/delete into one line without the name collapsing. Desktop keeps the inline row and never opens this. */
export function EditProductModal({ product, onClose, onRequestDelete }: EditProductModalProps) {
  const [priceInput, setPriceInput] = useState('');
  const [isAvailable, setIsAvailable] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    if (!product) return;
    setPriceInput(product.price != null ? String(product.price) : '');
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

    if (Object.keys(input).length === 0) {
      handleClose();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await updateAdminProduct(product.id, input);
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
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-secondary">Precio</span>
              <p className="text-sm text-text-secondary">
                {product.sizes.map((s) => `${s.name} ${formatCOP(s.price)}`).join(' · ')} - se precia por tamaño, no aquí.
              </p>
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
