import { useEffect, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { createAdminProduct } from '@/lib/api';
import { useToastStore } from '@/store/useToastStore';
import type { AdminProduct, ProductCategoryId } from '@/types/api';

interface AddProductModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (product: AdminProduct) => void;
  categories: { id: ProductCategoryId; name: string }[];
  /** Preselects the category the admin was already looking at (e.g. "+ Agregar producto" under Entradas). */
  defaultCategoryId?: ProductCategoryId;
}

/** Admin-only (see routes/products.ts POST /). Flat-priced products only - matches Todo.MD's literal scope (name/description/price/category/availability); a product priced per size or requiring a pizza flavor still has to be seeded directly. */
export function AddProductModal({ open, onClose, onCreated, categories, defaultCategoryId }: AddProductModalProps) {
  const [categoryId, setCategoryId] = useState<ProductCategoryId | ''>('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [isAvailable, setIsAvailable] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    if (!open) return;
    setCategoryId(defaultCategoryId ?? categories[0]?.id ?? '');
    setName('');
    setDescription('');
    setPrice('');
    setIsAvailable(true);
    setError(null);
  }, [open, defaultCategoryId, categories]);

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryId) {
      setError('Elige una categoría');
      return;
    }
    if (name.trim() === '') {
      setError('El nombre es obligatorio');
      return;
    }
    const parsedPrice = Number(price);
    if (!Number.isInteger(parsedPrice) || parsedPrice <= 0) {
      setError('El precio debe ser un número entero mayor a 0');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const created = await createAdminProduct({
        categoryId,
        name: name.trim(),
        description: description.trim() || undefined,
        price: parsedPrice,
        isAvailable,
      });
      onCreated(created);
      pushToast(`${created.name} agregado al menú`);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el producto');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Agregar producto">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-secondary">Categoría</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value as ProductCategoryId)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

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

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-secondary">Precio</span>
          <input
            type="number"
            min={1}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={isAvailable} onChange={(e) => setIsAvailable(e.target.checked)} className="h-4 w-4 rounded border-border" />
          Disponible desde ya
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-60"
        >
          {submitting ? 'Creando...' : 'Crear producto'}
        </button>
      </form>
    </Modal>
  );
}
