import { useEffect, useState } from 'react';
import { mutate } from 'swr';
import { Modal } from '@/components/common/Modal';
import { createCity, updateCity } from '@/lib/api';
import { useToastStore } from '@/store/useToastStore';
import type { City } from '@/types/api';

interface CityModalProps {
  open: boolean;
  onClose: () => void;
  /** Present in edit mode; absent when creating a new city. */
  city?: City;
}

/** Admin only (see routes/locations.ts) - reachable only from the /ajustes/ubicaciones panel. */
export function CityModal({ open, onClose, city }: CityModalProps) {
  const isEdit = city != null;
  const [name, setName] = useState(city?.name ?? '');
  const [department, setDepartment] = useState(city?.department ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);

  // The parent keeps a single modal instance mounted and just swaps `city`/`open` - without
  // this, useState's initial value (only read on first mount) would leave the form showing
  // whichever city was open first, not the one just clicked (same bug as NeighborhoodModal).
  useEffect(() => {
    if (!open) return;
    setName(city?.name ?? '');
    setDepartment(city?.department ?? '');
    setError(null);
  }, [open, city]);

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
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit) {
        await updateCity(city.id, name.trim(), department.trim() || undefined);
        pushToast('Ciudad actualizada');
      } else {
        await createCity(name.trim(), department.trim() || undefined);
        pushToast('Ciudad creada');
      }
      await mutate('/locations/cities');
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la ciudad');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title={isEdit ? 'Editar ciudad' : 'Crear ciudad'}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre de la ciudad"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
        />
        <input
          type="text"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          placeholder="Departamento (opcional)"
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
