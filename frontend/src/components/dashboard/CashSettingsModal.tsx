import { useState } from 'react';
import { mutate } from 'swr';
import { Modal } from '@/components/common/Modal';
import { updateCashFlowSettings } from '@/lib/api';
import { useToastStore } from '@/store/useToastStore';

interface CashSettingsModalProps {
  open: boolean;
  onClose: () => void;
  currentDefault: number;
}

export function CashSettingsModal({ open, onClose, currentDefault }: CashSettingsModalProps) {
  const [amount, setAmount] = useState(String(currentDefault));
  const [submitting, setSubmitting] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const updated = await updateCashFlowSettings(Number(amount) || 0);
      await mutate('/cash-flow/settings', updated, { revalidate: false });
      pushToast('Efectivo inicial actualizado');
      onClose();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo actualizar', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Efectivo inicial por defecto">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">Monto con el que se abre automáticamente cada nuevo día de caja.</p>
        <input
          autoFocus
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-60"
        >
          Guardar
        </button>
      </form>
    </Modal>
  );
}
