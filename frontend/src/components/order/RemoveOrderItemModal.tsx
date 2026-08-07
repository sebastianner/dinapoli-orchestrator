import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/common/Modal';

interface RemoveOrderItemModalProps {
  open: boolean;
  /** One row per staged item group, already grouped/quantity-labeled (e.g. "2x Coca-Cola") - same items the trash icon already hid from the order panel. */
  items: { key: string; description: string }[];
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/**
 * Confirms before actually sending a batch of staged item removals - tapping
 * a trash icon in OrderOverview only hides that item locally and stages it
 * (see pendingRemovalIds there); nothing is deleted server-side until this
 * modal's "Eliminar" is confirmed, listing every staged item together so
 * staff can review the whole batch (and any staged additions) before
 * committing. Same single-step confirm pattern as DeleteOrderModal/
 * DeleteProductModal, just batch-scoped instead of whole-order/product-scoped.
 */
export function RemoveOrderItemModal({ open, items, onClose, onConfirm }: RemoveOrderItemModalProps) {
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
      setError(err instanceof Error ? err.message : 'No se pudo eliminar los productos');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title={items.length > 1 ? 'Eliminar productos' : 'Eliminar producto'}>
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger">
          <AlertTriangle size={28} />
        </div>

        <p className="text-sm text-text-primary">
          Vas a eliminar {items.length > 1 ? `${items.length} productos` : 'este producto'} de la orden:
        </p>

        <ul className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm text-text-primary">
          {items.map((item) => (
            <li key={item.key} className="border-b border-border py-1.5 last:border-b-0">
              {item.description}
            </li>
          ))}
        </ul>

        <p className="text-sm text-text-secondary">Si ya se imprimieron en cocina, se enviará un aviso para que no se preparen.</p>

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
    </Modal>
  );
}
