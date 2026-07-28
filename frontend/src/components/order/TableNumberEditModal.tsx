import { useEffect, useState } from 'react';
import { mutate } from 'swr';
import { AlertTriangle, Minus, Plus } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { updateOrderTable } from '@/lib/api';
import { useOrderStore } from '@/store/useOrderStore';
import { useToastStore } from '@/store/useToastStore';
import type { Order } from '@/types/api';

interface TableNumberEditModalProps {
  order: Order | null;
  onClose: () => void;
}

const MIN_TABLE = 1;
const MAX_TABLE = 9;
const clamp = (n: number) => Math.min(MAX_TABLE, Math.max(MIN_TABLE, n));

/** Admin only (see routes/orders.ts PUT /:id/table) - two-step (edit, then confirm), same pattern as PromoSettingsModal. */
export function TableNumberEditModal({ order, onClose }: TableNumberEditModalProps) {
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [tableNumber, setTableNumber] = useState(MIN_TABLE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);
  const upsertActiveOrder = useOrderStore((s) => s.upsertActiveOrder);

  useEffect(() => {
    if (!order) return;
    setStep('edit');
    setTableNumber(order.tableNumber ?? MIN_TABLE);
    setError(null);
  }, [order]);

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const adjust = (delta: number) => setTableNumber((n) => clamp(n + delta));

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!Number.isInteger(tableNumber) || tableNumber < MIN_TABLE || tableNumber > MAX_TABLE) {
      setError(`La mesa debe ser un número entre ${MIN_TABLE} y ${MAX_TABLE}`);
      return;
    }
    setError(null);
    setStep('confirm');
  };

  const handleConfirm = async () => {
    if (!order) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await updateOrderTable(order.id, tableNumber);
      upsertActiveOrder(updated);
      await mutate(`/orders/${order.id}`, updated, { revalidate: false });
      await mutate((key) => typeof key === 'string' && key.startsWith('/orders?'));
      await mutate('/tables');
      pushToast(`Orden #${order.id} movida a la mesa ${tableNumber}`);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la mesa');
    } finally {
      setSubmitting(false);
    }
  };

  if (!order) return null;

  const changed = tableNumber !== order.tableNumber;

  return (
    <Modal open={order != null} onClose={handleClose} title={`Editar mesa - Orden #${order.id}`}>
      {step === 'edit' ? (
        <form onSubmit={handleContinue} className="flex flex-col gap-3">
          <span className="text-xs font-medium text-text-secondary">Número de mesa</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => adjust(-1)}
              disabled={tableNumber <= MIN_TABLE}
              aria-label="Restar mesa"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600 disabled:opacity-40"
            >
              <Minus size={16} />
            </button>
            <input
              autoFocus
              type="number"
              min={MIN_TABLE}
              max={MAX_TABLE}
              value={tableNumber}
              onChange={(e) => setTableNumber(clamp(Number(e.target.value) || MIN_TABLE))}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-center text-sm text-text-primary outline-none focus:border-brand-400"
            />
            <button
              type="button"
              onClick={() => adjust(1)}
              disabled={tableNumber >= MAX_TABLE}
              aria-label="Sumar mesa"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600 disabled:opacity-40"
            >
              <Plus size={16} />
            </button>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button type="submit" className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600">
            Continuar
          </button>
        </form>
      ) : (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warning-bg text-warning">
            <AlertTriangle size={28} />
          </div>

          <p className="text-sm text-text-primary">Vas a mover la orden #{order.id}:</p>

          <div className="w-full rounded-xl border border-border bg-surface p-3 text-left text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Mesa</span>
              <span className={changed ? 'font-semibold text-brand-700' : 'text-text-primary'}>
                {order.tableNumber} {changed && <>→ {tableNumber}</>}
              </span>
            </div>
          </div>

          <p className="text-xs text-text-secondary">La mesa anterior queda libre si no tiene otras órdenes abiertas.</p>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex w-full gap-3">
            <button
              type="button"
              onClick={() => setStep('edit')}
              className="flex-1 rounded-lg border border-border py-2.5 text-sm font-semibold text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
            >
              Atrás
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting || !changed}
              className="flex-1 rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-60"
            >
              {submitting ? 'Guardando...' : 'Confirmar cambio'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
