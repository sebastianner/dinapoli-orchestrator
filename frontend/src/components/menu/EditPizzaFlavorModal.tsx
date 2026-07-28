import { useEffect, useState } from 'react';
import { mutate } from 'swr';
import classNames from 'classnames';
import { Modal } from '@/components/common/Modal';
import { updatePizzaFlavor } from '@/lib/api';
import { useToastStore } from '@/store/useToastStore';
import type { AdminPizzaFlavor, PizzaGroupId } from '@/types/api';

interface EditPizzaFlavorModalProps {
  flavor: AdminPizzaFlavor | null;
  onClose: () => void;
  groups: { id: PizzaGroupId; name: string }[];
}

/**
 * Admin-only (see routes/pizzaAdmin.ts PUT /flavors/:id). No delete in this
 * pass - a flavor can be referenced by order history, same "mark unavailable
 * instead" reasoning as products (not wired up here yet since flavors have no
 * isAvailable toggle exposed by the backend either - out of scope for now).
 */
export function EditPizzaFlavorModal({ flavor, onClose, groups }: EditPizzaFlavorModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [groupIds, setGroupIds] = useState<PizzaGroupId[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    if (!flavor) return;
    setName(flavor.name);
    setDescription(flavor.description ?? '');
    setGroupIds(flavor.groupIds);
    setError(null);
  }, [flavor]);

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const toggleGroup = (id: PizzaGroupId) => {
    setGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flavor) return;
    if (name.trim() === '') {
      setError('El nombre es obligatorio');
      return;
    }
    if (groupIds.length === 0) {
      setError('Elige al menos una categoría');
      return;
    }

    const input: { name?: string; description?: string | null; groupIds?: PizzaGroupId[] } = {};
    if (name.trim() !== flavor.name) input.name = name.trim();
    const nextDescription = description.trim() || null;
    if (nextDescription !== flavor.description) input.description = nextDescription;
    if (groupIds.length !== flavor.groupIds.length || groupIds.some((g) => !flavor.groupIds.includes(g))) {
      input.groupIds = groupIds;
    }

    if (Object.keys(input).length === 0) {
      handleClose();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await updatePizzaFlavor(flavor.id, input);
      await mutate('/pizza-admin');
      pushToast(`${name.trim()} actualizado`);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={flavor != null} onClose={handleClose} title={flavor ? flavor.name : ''}>
      {flavor && (
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

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text-secondary">Descripción</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-secondary">Categorías</span>
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <label
                  key={g.id}
                  className={classNames(
                    'flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-fast',
                    groupIds.includes(g.id) ? 'border-brand-500 bg-brand-500/10 text-brand-700' : 'border-border text-text-secondary'
                  )}
                >
                  <input type="checkbox" className="hidden" checked={groupIds.includes(g.id)} onChange={() => toggleGroup(g.id)} />
                  {g.name}
                </label>
              ))}
            </div>
          </div>

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
