import { useEffect, useState } from 'react';
import { mutate } from 'swr';
import { Modal } from '@/components/common/Modal';
import { createNeighborhood, updateNeighborhood } from '@/lib/api';
import { useToastStore } from '@/store/useToastStore';
import type { Neighborhood } from '@/types/api';

interface NeighborhoodModalProps {
  open: boolean;
  onClose: () => void;
  /** The city this neighborhood belongs to (create mode) or already belongs to (edit mode, city can't change). */
  cityId: number;
  /** Present in edit mode; absent when creating a new neighborhood. */
  neighborhood?: Neighborhood;
}

/** Admin only (see routes/locations.ts) - reachable only from the /ajustes/ubicaciones panel. */
export function NeighborhoodModal({ open, onClose, cityId, neighborhood }: NeighborhoodModalProps) {
  const isEdit = neighborhood != null;
  const [name, setName] = useState(neighborhood?.name ?? '');
  const [deliveryFee, setDeliveryFee] = useState(String(neighborhood?.deliveryFee ?? 0));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);

  // The parent keeps a single modal instance mounted and just swaps `neighborhood`/`open` -
  // without this, useState's initial value (only read on first mount) would leave the form
  // showing whichever neighborhood was open first, not the one just clicked.
  useEffect(() => {
    if (!open) return;
    setName(neighborhood?.name ?? '');
    setDeliveryFee(String(neighborhood?.deliveryFee ?? 0));
    setError(null);
  }, [open, neighborhood]);

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('El nombre es obligatorio');
      return;
    }
    const fee = Number(deliveryFee) || 0;
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit) {
        await updateNeighborhood(neighborhood.id, name.trim(), fee);
        pushToast('Barrio actualizado');
      } else {
        await createNeighborhood(name.trim(), cityId, fee);
        pushToast('Barrio creado');
      }
      await mutate(`/locations/cities/${cityId}/neighborhoods`);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el barrio');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title={isEdit ? 'Editar barrio' : 'Crear barrio'}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del barrio"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
        />
        <input
          type="number"
          min={0}
          value={deliveryFee}
          onChange={(e) => setDeliveryFee(e.target.value)}
          placeholder="Costo de domicilio"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
        />

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-60"
        >
          {submitting ? 'Guardando...' : 'Guardar'}
        </button>
      </form>
    </Modal>
  );
}
