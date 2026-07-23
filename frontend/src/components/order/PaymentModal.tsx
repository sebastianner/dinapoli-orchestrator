import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { formatCOP } from '@/lib/format';
import { completeOrder } from '@/lib/api';
import type { Order, PaymentMethod } from '@/types/api';

interface PaymentSplitRow {
  clientId: string;
  method: PaymentMethod;
  amount: string;
  tipAmount: string;
}

const methodLabels: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

interface PaymentModalProps {
  open: boolean;
  order: Order;
  onClose: () => void;
  onSuccess: () => void;
}

export function PaymentModal({ open, order, onClose, onSuccess }: PaymentModalProps) {
  const totalOwed = order.total + order.tip + order.deliveryFee;

  const [splits, setSplits] = useState<PaymentSplitRow[]>(() => [
    { clientId: crypto.randomUUID(), method: order.paymentMethod ?? 'cash', amount: String(totalOwed), tipAmount: String(order.tip) },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sumAmount = splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const sumTip = splits.reduce((sum, s) => sum + (Number(s.tipAmount) || 0), 0);
  const remaining = totalOwed - sumAmount;
  const isValid = sumAmount === totalOwed && sumTip === order.tip && splits.every((s) => Number(s.amount) > 0);

  const reset = () => {
    setSplits([{ clientId: crypto.randomUUID(), method: order.paymentMethod ?? 'cash', amount: String(totalOwed), tipAmount: String(order.tip) }]);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const updateSplit = (clientId: string, patch: Partial<PaymentSplitRow>) => {
    setSplits((prev) => prev.map((s) => (s.clientId === clientId ? { ...s, ...patch } : s)));
  };

  const addSplit = () => {
    setSplits((prev) => [...prev, { clientId: crypto.randomUUID(), method: 'cash', amount: String(Math.max(remaining, 0)), tipAmount: '0' }]);
  };

  const removeSplit = (clientId: string) => {
    setSplits((prev) => prev.filter((s) => s.clientId !== clientId));
  };

  const handleSubmit = async () => {
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await completeOrder(
        order.id,
        splits.map((s) => ({ method: s.method, amount: Number(s.amount), tipAmount: Number(s.tipAmount) || 0 })),
      );
      reset();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la orden');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Cobrar orden" className="max-w-lg">
      <div className="mb-4 flex items-center justify-between rounded-lg bg-brand-500/10 px-4 py-3">
        <span className="text-sm font-medium text-text-secondary">Total a pagar</span>
        <span className="text-xl font-bold text-brand-700">{formatCOP(totalOwed)}</span>
      </div>

      <div className="flex flex-col gap-3">
        {splits.map((split) => (
          <div key={split.clientId} className="flex items-center gap-2">
            <select
              value={split.method}
              onChange={(e) => updateSplit(split.clientId, { method: e.target.value as PaymentMethod })}
              className="rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
            >
              {(Object.keys(methodLabels) as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {methodLabels[m]}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              value={split.amount}
              onChange={(e) => updateSplit(split.clientId, { amount: e.target.value })}
              placeholder="Monto"
              className="w-28 rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
            />
            <input
              type="number"
              min={0}
              value={split.tipAmount}
              onChange={(e) => updateSplit(split.clientId, { tipAmount: e.target.value })}
              placeholder="Propina"
              className="w-24 rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
            />
            {splits.length > 1 && (
              <button
                type="button"
                onClick={() => removeSplit(split.clientId)}
                aria-label="Quitar método de pago"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-danger-bg hover:text-danger"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={addSplit}
          className="self-start text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          + Dividir en otro método de pago
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-1 text-sm">
        <div className="flex justify-between text-text-secondary">
          <span>Asignado</span>
          <span className={remaining !== 0 ? 'font-medium text-danger' : 'font-medium text-success'}>{formatCOP(sumAmount)}</span>
        </div>
        {remaining !== 0 && (
          <div className="flex justify-between text-text-secondary">
            <span>{remaining > 0 ? 'Falta' : 'Sobra'}</span>
            <span className="font-medium text-danger">{formatCOP(Math.abs(remaining))}</span>
          </div>
        )}
        {sumTip !== order.tip && (
          <p className="text-danger">La propina asignada debe sumar {formatCOP(order.tip)}</p>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!isValid || submitting}
        className="mt-4 w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-50"
      >
        {submitting ? 'Procesando...' : 'Confirmar cobro'}
      </button>
    </Modal>
  );
}
