import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { mutate } from 'swr';
import { Modal } from '@/components/common/Modal';
import type { Employee } from '@/types/api';
import { createEmployee } from '@/lib/api';
import { avatarSrc, dicebearUrl, randomSeed } from '@/lib/avatar';
import { useAvatarOverrideStore } from '@/store/useAvatarOverrideStore';
import { useToastStore } from '@/store/useToastStore';

interface EmployeeModalProps {
  open: boolean;
  onClose: () => void;
  /** Present in edit mode; absent when creating a new employee. */
  employee?: Employee;
}

export function EmployeeModal({ open, onClose, employee }: EmployeeModalProps) {
  const isEdit = employee != null;
  const [name, setName] = useState(employee?.name ?? '');
  const [seed, setSeed] = useState(() => randomSeed());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setOverride = useAvatarOverrideStore((s) => s.setOverride);
  const pushToast = useToastStore((s) => s.push);

  const previewSrc = isEdit ? avatarSrc(employee, seed) : avatarSrc({ name: name || ' ', pictureUrl: null }, seed);

  const handleClose = () => {
    setName(employee?.name ?? '');
    setSeed(randomSeed());
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isEdit) {
      setOverride(employee.id, seed);
      pushToast('Avatar actualizado');
      handleClose();
      return;
    }

    if (!name.trim()) {
      setError('El nombre es obligatorio');
      return;
    }

    setSubmitting(true);
    try {
      await createEmployee(name.trim(), dicebearUrl(seed));
      await mutate('/employees/active');
      pushToast('Empleado creado');
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el empleado');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title={isEdit ? 'Editar avatar' : 'Crear empleado'}>
      <form onSubmit={handleSubmit} className="flex flex-col items-center gap-4">
        <div className="relative h-28 w-28 overflow-hidden rounded-full border-2 border-border bg-surface">
          <img src={previewSrc} alt="Vista previa del avatar" className="h-full w-full" />
        </div>

        <button
          type="button"
          onClick={() => setSeed(randomSeed())}
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
        >
          <RefreshCw size={13} /> Generar otro avatar
        </button>

        {isEdit ? (
          <p className="text-sm text-text-secondary">{employee.name}</p>
        ) : (
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del empleado"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
          />
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-60"
        >
          {isEdit ? 'Guardar' : submitting ? 'Creando...' : 'Crear empleado'}
        </button>
      </form>
    </Modal>
  );
}
