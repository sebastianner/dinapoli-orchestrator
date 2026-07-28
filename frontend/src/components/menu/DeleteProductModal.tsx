import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { deleteAdminProduct } from '@/lib/api';
import type { AdminProduct } from '@/types/api';

interface DeleteProductModalProps {
  product: AdminProduct | null;
  onClose: () => void;
  onDeleted: () => void;
}

/** Admin-only, irreversible (see routes/products.ts DELETE /:id) - same single-step confirm pattern as DeleteOrderModal. The server itself refuses (409) if the product has order history, surfaced here as the error message rather than a special case. */
export function DeleteProductModal({ product, onClose, onDeleted }: DeleteProductModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const handleConfirm = async () => {
    if (!product) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteAdminProduct(product.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el producto');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={product != null} onClose={handleClose} title="Eliminar producto">
      {product && (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger">
            <AlertTriangle size={28} />
          </div>

          <p className="text-sm text-text-primary">
            Vas a eliminar <span className="font-semibold">{product.name}</span> del menú de forma permanente.
          </p>
          <p className="text-sm text-text-secondary">
            Si el producto ya tiene órdenes registradas, no se podrá eliminar - marcalo como no disponible en su lugar.
          </p>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex w-full gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 rounded-lg border border-border py-2.5 text-sm font-semibold text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="flex-1 rounded-lg bg-danger py-2.5 text-sm font-semibold text-white transition-opacity duration-fast hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? 'Eliminando...' : 'Eliminar definitivamente'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
