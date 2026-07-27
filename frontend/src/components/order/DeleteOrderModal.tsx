import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { deleteOrder } from '@/lib/api';
import type { Order } from '@/types/api';

interface DeleteOrderModalProps {
  order: Order | null;
  onClose: () => void;
  onDeleted: () => void;
}

/** Admin-only, irreversible (see routes/orders.ts DELETE /:id) - this confirmation is the only safeguard, there's no undo after it. */
export function DeleteOrderModal({ order, onClose, onDeleted }: DeleteOrderModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const handleConfirm = async () => {
    if (!order) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteOrder(order.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la orden');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={order != null} onClose={handleClose} title="Eliminar orden">
      {order && (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger">
            <AlertTriangle size={28} />
          </div>

          <p className="text-sm text-text-primary">
            Vas a eliminar la <span className="font-semibold">Orden #{order.id}</span> de forma permanente.
          </p>
          <p className="text-sm text-text-secondary">
            Se borrarán también sus productos, pagos y comandas asociadas. Esta acción no se puede deshacer.
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
