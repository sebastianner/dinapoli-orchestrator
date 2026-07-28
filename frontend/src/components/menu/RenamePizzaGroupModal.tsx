import { useEffect, useState } from 'react';
import { mutate } from 'swr';
import { Modal } from '@/components/common/Modal';
import { renamePizzaGroup } from '@/lib/api';
import { useToastStore } from '@/store/useToastStore';
import type { AdminPizzaGroup } from '@/types/api';

interface RenamePizzaGroupModalProps {
  group: AdminPizzaGroup | null;
  onClose: () => void;
}

/**
 * Admin-only (see routes/pizzaAdmin.ts PUT /groups/:groupId). Only renames the
 * display name - which group you're editing (Clásicas/Especiales) is picked
 * via the <select> in PizzaSettingsPanel, not here, since only two groups
 * exist and neither is created/deleted in this pass.
 */
export function RenamePizzaGroupModal({ group, onClose }: RenamePizzaGroupModalProps) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    if (!group) return;
    setName(group.name);
    setError(null);
  }, [group]);

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!group) return;
    if (name.trim() === '') {
      setError('El nombre es obligatorio');
      return;
    }
    if (name.trim() === group.name) {
      handleClose();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await renamePizzaGroup(group.id, name.trim());
      await mutate('/pizza-admin');
      pushToast('Categoría renombrada');
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo renombrar');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={group != null} onClose={handleClose} title="Renombrar categoría">
      {group && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text-secondary">Nombre</span>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
            />
          </label>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-60"
          >
            {submitting ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </form>
      )}
    </Modal>
  );
}
