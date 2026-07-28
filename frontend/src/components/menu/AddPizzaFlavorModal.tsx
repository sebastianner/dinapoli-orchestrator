import { useEffect, useState } from 'react';
import classNames from 'classnames';
import { Modal } from '@/components/common/Modal';
import { createPizzaFlavor } from '@/lib/api';
import { useToastStore } from '@/store/useToastStore';
import type { AdminPizzaFlavor, PizzaGroupId } from '@/types/api';

interface AddPizzaFlavorModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (flavor: AdminPizzaFlavor) => void;
  groups: { id: PizzaGroupId; name: string }[];
  /** Preselects the group the admin was already looking at. */
  defaultGroupId?: PizzaGroupId;
}

/** Admin-only (see routes/pizzaAdmin.ts POST /flavors). A flavor can be offered under more than one group, so groupIds is a checkbox set, not a single choice. */
export function AddPizzaFlavorModal({ open, onClose, onCreated, groups, defaultGroupId }: AddPizzaFlavorModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [groupIds, setGroupIds] = useState<PizzaGroupId[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setGroupIds(defaultGroupId ? [defaultGroupId] : []);
    setError(null);
  }, [open, defaultGroupId]);

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const toggleGroup = (id: PizzaGroupId) => {
    setGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() === '') {
      setError('El nombre es obligatorio');
      return;
    }
    if (groupIds.length === 0) {
      setError('Elige al menos una categoría');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const created = await createPizzaFlavor({ name: name.trim(), description: description.trim() || undefined, groupIds });
      onCreated(created);
      pushToast(`${created.name} agregado`);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el sabor');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Agregar sabor">
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
          <span className="text-xs font-medium text-text-secondary">Descripción (opcional)</span>
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
          {submitting ? 'Creando...' : 'Crear sabor'}
        </button>
      </form>
    </Modal>
  );
}
