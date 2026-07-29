import { useEffect, useState } from 'react';
import { mutate } from 'swr';
import classNames from 'classnames';
import { ChevronRight, Pencil, Plus, Search } from 'lucide-react';
import { usePizzaAdminData } from '@/lib/queries';
import { updatePizzaGroupSizePrice } from '@/lib/api';
import { useToastStore } from '@/store/useToastStore';
import { RenamePizzaGroupModal } from '@/components/menu/RenamePizzaGroupModal';
import { AddPizzaFlavorModal } from '@/components/menu/AddPizzaFlavorModal';
import { EditPizzaFlavorModal } from '@/components/menu/EditPizzaFlavorModal';
import type { AdminPizzaFlavor, AdminPizzaGroupSize, PizzaGroupId } from '@/types/api';

/**
 * Pizzas aren't `products` rows (see menuService.buildPizzaCategory), so they
 * get their own admin surface instead of reusing ProductSettingsRow/
 * EditProductModal. Only two groups exist and neither is created/deleted
 * here, so switching between them is a <select> (design option 2, picked
 * over a free-text box) - renaming is a separate explicit action so it's
 * never confused with the switcher.
 */
export function PizzaSettingsPanel() {
  const { data, isLoading } = usePizzaAdminData();
  const [activeGroupId, setActiveGroupId] = useState<PizzaGroupId>('classic');
  const [search, setSearch] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [addingFlavor, setAddingFlavor] = useState(false);
  const [editingFlavor, setEditingFlavor] = useState<AdminPizzaFlavor | null>(null);

  const refresh = () => mutate('/pizza-admin');

  if (isLoading || !data) return <p className="text-sm text-text-secondary">Cargando...</p>;

  const activeGroup = data.groups.find((g) => g.id === activeGroupId) ?? data.groups[0];
  if (!activeGroup) return null;

  const groupOptions = data.groups.map((g) => ({ id: g.id, name: g.name }));
  const flavors = data.flavors.filter((f) => f.groupIds.includes(activeGroup.id));
  const q = search.trim().toLowerCase();
  const filteredFlavors = q ? flavors.filter((f) => f.name.toLowerCase().includes(q)) : flavors;

  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={activeGroup.id}
          onChange={(e) => setActiveGroupId(e.target.value as PizzaGroupId)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-text-primary outline-none focus:border-brand-400"
        >
          {data.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setRenaming(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
        >
          <Pencil size={13} /> Renombrar
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setAddingFlavor(true)}
          className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white transition-colors duration-fast hover:bg-brand-600"
        >
          <Plus size={14} /> Agregar sabor
        </button>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-secondary">Precio por tamaño</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {activeGroup.sizes.map((size) => (
            <SizePriceInput key={size.id} groupId={activeGroup.id} size={size} onSaved={refresh} />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-secondary">{flavors.length} sabores</p>
        <label className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-text-secondary">
          <Search size={14} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Buscar sabor en ${activeGroup.name}…`}
            className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-secondary"
          />
        </label>
        <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
          {filteredFlavors.map((flavor) => (
            <FlavorRow key={flavor.id} flavor={flavor} onOpenEdit={() => setEditingFlavor(flavor)} />
          ))}
          {filteredFlavors.length === 0 && <p className="py-4 text-center text-sm text-text-secondary">Sin resultados</p>}
        </div>
      </div>

      <RenamePizzaGroupModal group={renaming ? activeGroup : null} onClose={() => setRenaming(false)} />
      <AddPizzaFlavorModal
        open={addingFlavor}
        defaultGroupId={activeGroup.id}
        groups={groupOptions}
        onClose={() => setAddingFlavor(false)}
        onCreated={refresh}
      />
      <EditPizzaFlavorModal flavor={editingFlavor} groups={groupOptions} onClose={() => setEditingFlavor(null)} />
    </section>
  );
}

interface SizePriceInputProps {
  groupId: PizzaGroupId;
  size: AdminPizzaGroupSize;
  onSaved: () => void;
}

function SizePriceInput({ groupId, size, onSaved }: SizePriceInputProps) {
  const [value, setValue] = useState(size.price != null ? String(size.price) : '');
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    setValue(size.price != null ? String(size.price) : '');
  }, [size.price]);

  const commit = async () => {
    const trimmed = value.trim();
    const nextPrice = trimmed === '' ? null : Number(trimmed);
    if (nextPrice !== null && (!Number.isInteger(nextPrice) || nextPrice <= 0)) {
      setValue(size.price != null ? String(size.price) : '');
      return;
    }
    if (nextPrice === size.price) return;

    try {
      await updatePizzaGroupSizePrice(groupId, size.id, nextPrice);
      onSaved();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo actualizar el precio', 'error');
      setValue(size.price != null ? String(size.price) : '');
    }
  };

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-bg px-3 py-2">
      <span className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">{size.name}</span>
      <input
        type="number"
        min={1}
        value={value}
        placeholder="Por porción"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className="w-full bg-transparent text-right text-sm font-semibold text-text-primary outline-none placeholder:text-xs placeholder:font-normal placeholder:text-text-secondary"
      />
    </div>
  );
}

interface FlavorRowProps {
  flavor: AdminPizzaFlavor;
  onOpenEdit: () => void;
}

function FlavorRow({ flavor, onOpenEdit }: FlavorRowProps) {
  return (
    <button
      type="button"
      onClick={onOpenEdit}
      className={classNames(
        'flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left transition-colors duration-fast hover:border-brand-400',
        !flavor.isAvailable && 'opacity-60'
      )}
    >
      <span className={classNames('h-2 w-2 shrink-0 rounded-full', flavor.isAvailable ? 'bg-success' : 'bg-text-secondary')} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-primary">{flavor.name}</p>
        {flavor.description && <p className="truncate text-xs text-text-secondary">{flavor.description}</p>}
      </div>
      {flavor.groupIds.length > 1 && (
        <span className={classNames('shrink-0 whitespace-nowrap rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700')}>
          Ambas
        </span>
      )}
      <ChevronRight size={16} className="shrink-0 text-text-secondary" />
    </button>
  );
}
