import { useEffect, useState } from 'react';
import { mutate } from 'swr';
import { AlertTriangle, Minus, Plus } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { increaseTableCount, decreaseTableCount } from '@/lib/api';
import { useToastStore } from '@/store/useToastStore';

interface TableCountEditorProps {
  currentCount: number;
}

const MIN_TABLES = 1;

/** Admin only (see routes/tables.ts POST /increase, /decrease) - each click steps the restaurant's table count by exactly one, per Todo.MD's "plus and minus button... instead of manually typing". Saving a multi-step change (e.g. +3) just calls the single-step endpoint that many times in sequence. */
export function TableCountEditor({ currentCount }: TableCountEditorProps) {
  const [pending, setPending] = useState(currentCount);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);

  // Stay in sync with the real count (e.g. after a save, or another admin's
  // change arriving via the live tables_updated broadcast) as long as there's
  // no unsaved edit in progress.
  useEffect(() => {
    if (!confirming) setPending(currentCount);
  }, [currentCount, confirming]);

  const adjust = (delta: number) => setPending((n) => Math.max(MIN_TABLES, n + delta));
  const delta = pending - currentCount;

  const handleCancel = () => {
    if (submitting) return;
    setConfirming(false);
    setError(null);
    setPending(currentCount);
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    let reached = currentCount;
    try {
      const steps = Math.abs(delta);
      for (let i = 0; i < steps; i++) {
        const tables = delta > 0 ? await increaseTableCount() : await decreaseTableCount();
        reached = tables.length;
      }
      await mutate('/tables', undefined, { revalidate: true });
      pushToast(`Número de mesas actualizado a ${reached}`);
      setConfirming(false);
    } catch (err) {
      setPending(reached); // resync to wherever the sequence actually got to before it failed
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el número de mesas');
      await mutate('/tables');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-semibold text-text-primary">Número de mesas</p>
        <p className="text-xs text-text-secondary">Agrega o quita mesas del salón - una mesa ocupada no se puede quitar.</p>
      </div>

      <div className="flex items-center gap-3 sm:shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => adjust(-1)}
            disabled={pending <= MIN_TABLES}
            aria-label="Restar mesa"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600 disabled:opacity-40"
          >
            <Minus size={15} />
          </button>
          <span className="w-8 text-center text-lg font-bold text-text-primary num">{pending}</span>
          <button
            type="button"
            onClick={() => adjust(1)}
            aria-label="Sumar mesa"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
          >
            <Plus size={15} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={delta === 0}
          className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-40"
        >
          Guardar
        </button>
      </div>

      <Modal open={confirming} onClose={handleCancel} title="Confirmar cambio de mesas">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warning-bg text-warning">
            <AlertTriangle size={28} />
          </div>

          <p className="text-sm text-text-primary">
            {delta > 0
              ? `Vas a agregar ${delta === 1 ? 'la mesa' : `${delta} mesas`} ${delta === 1 ? currentCount + 1 : `${currentCount + 1} a ${pending}`}.`
              : `Vas a quitar ${Math.abs(delta) === 1 ? 'la mesa' : `${Math.abs(delta)} mesas`} ${Math.abs(delta) === 1 ? currentCount : `${pending + 1} a ${currentCount}`}.`}
          </p>

          <div className="w-full rounded-xl border border-border bg-surface p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Número de mesas</span>
              <span className="font-semibold text-brand-700">
                {currentCount} → {pending}
              </span>
            </div>
          </div>

          {delta < 0 && <p className="text-xs text-text-secondary">Si alguna de esas mesas tiene una orden abierta, la operación se detiene ahí y no se pierde nada.</p>}

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex w-full gap-3">
            <button
              type="button"
              onClick={handleCancel}
              disabled={submitting}
              className="flex-1 rounded-lg border border-border py-2.5 text-sm font-semibold text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="flex-1 rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-60"
            >
              {submitting ? 'Guardando...' : 'Confirmar cambio'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
