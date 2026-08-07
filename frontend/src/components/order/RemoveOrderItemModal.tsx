import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/common/Modal';

interface RemoveOrderItemModalProps {
  /** null closes the modal - same on/off-by-presence convention as DeleteOrderModal/DeleteProductModal's `order`/`product` props. */
  item: { description: string } | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/**
 * Confirms before removing a single item from an already-submitted order - a
 * mistaken tap on the trash icon in OrderOverview shouldn't silently drop a
 * product mid-service. Same single-step confirm pattern as DeleteOrderModal/
 * DeleteProductModal, just item-scoped instead of whole-order/product-scoped.
 */
export function RemoveOrderItemModal({ item, onClose, onConfirm }: RemoveOrderItemModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el producto');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={item != null} onClose={handleClose} title="Eliminar producto">
      {item && (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger">
            <AlertTriangle size={28} />
          </div>

          <p className="text-sm text-text-primary">
            Vas a eliminar <span className="font-semibold">{item.description}</span> de la orden.
          </p>
          <p className="text-sm text-text-secondary">
            Si ya se imprimió en cocina, se enviará un aviso para que no se prepare.
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
              {submitting ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
