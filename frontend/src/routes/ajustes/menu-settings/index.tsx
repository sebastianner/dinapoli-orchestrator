import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { mutate } from 'swr';
import classNames from 'classnames';
import { ChevronRight, Pizza, Plus, Trash2 } from 'lucide-react';
import { useAdminProducts, useMenu } from '@/lib/queries';
import { updateAdminProduct } from '@/lib/api';
import { useToastStore } from '@/store/useToastStore';
import { formatCOP } from '@/lib/format';
import { isPizzaCategory } from '@/types/api';
import { AddProductModal } from '@/components/menu/AddProductModal';
import { DeleteProductModal } from '@/components/menu/DeleteProductModal';
import { EditProductModal } from '@/components/menu/EditProductModal';
import { PizzaSettingsPanel } from '@/components/menu/PizzaSettingsPanel';
import type { AdminProduct, ProductCategoryId } from '@/types/api';

export const Route = createFileRoute('/ajustes/menu-settings/')({
  // Admin-only - enforced by the parent /ajustes layout's beforeLoad.
  component: MenuSettingsPage,
});

type RailSelection = ProductCategoryId | 'pizzas';

function MenuSettingsPage() {
  const { data: products = [], isLoading } = useAdminProducts();
  const { data: menu } = useMenu();
  const pushToast = useToastStore((s) => s.push);

  const [addingFor, setAddingFor] = useState<ProductCategoryId | undefined>(undefined);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [deleting, setDeleting] = useState<AdminProduct | null>(null);
  // null until the menu loads, then defaults to the first product category -
  // pizzas isn't the default so admins land on the more common editing task.
  const [selected, setSelected] = useState<RailSelection | null>(null);

  const categories = useMemo(() => (menu ? menu.menu.filter((c) => !isPizzaCategory(c)).map((c) => ({ id: c.id, name: c.name })) : []), [menu]);

  const productsByCategory = useMemo(() => {
    const byCategory = new Map<ProductCategoryId, AdminProduct[]>();
    for (const product of products) {
      const list = byCategory.get(product.categoryId);
      if (list) list.push(product);
      else byCategory.set(product.categoryId, [product]);
    }
    return byCategory;
  }, [products]);

  const activeSelection: RailSelection = selected ?? categories[0]?.id ?? 'pizzas';
  const activeCategory = activeSelection === 'pizzas' ? undefined : categories.find((c) => c.id === activeSelection);
  const activeCategoryProducts = activeCategory ? (productsByCategory.get(activeCategory.id) ?? []) : [];

  const refresh = () => mutate('/products');

  const handleToggleAvailable = async (product: AdminProduct) => {
    try {
      await updateAdminProduct(product.id, { isAvailable: !product.isAvailable });
      await refresh();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo actualizar', 'error');
    }
  };

  const handleSavePrice = async (product: AdminProduct, price: number) => {
    try {
      await updateAdminProduct(product.id, { price });
      await refresh();
      pushToast(`Precio de ${product.name} actualizado`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo actualizar el precio', 'error');
    }
  };

  const openAddModal = (categoryId?: ProductCategoryId) => {
    setAddingFor(categoryId);
    setAddOpen(true);
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">Ajustes de menú</h1>
        <button
          type="button"
          onClick={() => openAddModal(undefined)}
          className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600"
        >
          <Plus size={15} /> Agregar producto
        </button>
      </div>

      {isLoading || !menu ? (
        <p className="text-sm text-text-secondary">Cargando...</p>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
          {/* Mobile/tablet (below `lg`): a horizontal scrollable chip strip, same
              pattern as TablesFloorPlanView's mobile fallback - never shrinks to
              fit, it just scrolls, so a category name never gets clipped. */}
          <nav className="flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {categories.map((c) => (
              <RailChip key={c.id} active={activeSelection === c.id} onClick={() => setSelected(c.id)}>
                {c.name}
              </RailChip>
            ))}
            <RailChip active={activeSelection === 'pizzas'} onClick={() => setSelected('pizzas')}>
              <Pizza size={13} /> Pizzas
            </RailChip>
          </nav>

          {/* Desktop (`lg` and up): a persistent vertical rail next to the
              content, so switching category never costs a page navigation. */}
          <nav className="hidden shrink-0 flex-col gap-1 lg:flex lg:w-44">
            {categories.map((c) => (
              <RailButton key={c.id} active={activeSelection === c.id} onClick={() => setSelected(c.id)}>
                {c.name}
              </RailButton>
            ))}
            <RailButton active={activeSelection === 'pizzas'} onClick={() => setSelected('pizzas')}>
              <Pizza size={14} /> Pizzas
            </RailButton>
          </nav>

          <div className="min-w-0 flex-1">
            {activeSelection === 'pizzas' ? (
              <PizzaSettingsPanel />
            ) : activeCategory ? (
              <section className="max-w-2xl">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold uppercase tracking-wide text-text-secondary">{activeCategory.name}</p>
                  <button
                    type="button"
                    onClick={() => openAddModal(activeCategory.id)}
                    className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                  >
                    + Agregar aquí
                  </button>
                </div>
                {activeCategoryProducts.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border p-4 text-sm text-text-secondary">
                    Sin productos todavía en esta categoría.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-col gap-2 lg:hidden">
                      {activeCategoryProducts.map((product) => (
                        <ProductListItem key={product.id} product={product} onOpenEdit={() => setEditing(product)} />
                      ))}
                    </div>
                    <div className="hidden flex-col gap-2 lg:flex">
                      {activeCategoryProducts.map((product) => (
                        <ProductSettingsRow
                          key={product.id}
                          product={product}
                          onToggleAvailable={() => handleToggleAvailable(product)}
                          onSavePrice={(price) => handleSavePrice(product, price)}
                          onDelete={() => setDeleting(product)}
                        />
                      ))}
                    </div>
                  </>
                )}
              </section>
            ) : null}
          </div>
        </div>
      )}

      <AddProductModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={refresh}
        categories={categories}
        defaultCategoryId={addingFor}
      />
      <EditProductModal
        product={editing}
        onClose={() => setEditing(null)}
        onRequestDelete={(product) => {
          setEditing(null);
          setDeleting(product);
        }}
      />
      <DeleteProductModal
        product={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          refresh();
          pushToast('Producto eliminado');
        }}
      />
    </div>
  );
}

interface RailItemProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function RailChip({ active, onClick, children }: RailItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors duration-fast',
        active ? 'border-brand-500 bg-brand-500 text-white' : 'border-border text-text-secondary'
      )}
    >
      {children}
    </button>
  );
}

function RailButton({ active, onClick, children }: RailItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        'flex items-center gap-1.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors duration-fast',
        active ? 'bg-brand-500/10 text-brand-600' : 'text-text-secondary hover:bg-bg hover:text-text-primary'
      )}
    >
      {children}
    </button>
  );
}

interface ProductSettingsRowProps {
  product: AdminProduct;
  onToggleAvailable: () => void;
  onSavePrice: (price: number) => void;
  onDelete: () => void;
}

function ProductSettingsRow({ product, onToggleAvailable, onSavePrice, onDelete }: ProductSettingsRowProps) {
  const [priceInput, setPriceInput] = useState(product.price != null ? String(product.price) : '');

  const commitPrice = () => {
    const parsed = Number(priceInput);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed === product.price) {
      setPriceInput(product.price != null ? String(product.price) : '');
      return;
    }
    onSavePrice(parsed);
  };

  return (
    <div className={classNames('flex items-center gap-3 rounded-xl border border-border bg-surface p-3', !product.isAvailable && 'opacity-60')}>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{product.name}</span>

      {product.price != null ? (
        <div className="flex items-center gap-1 text-sm">
          <span className="text-text-secondary">$</span>
          <input
            type="number"
            min={1}
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            onBlur={commitPrice}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className="w-24 rounded-lg border border-border bg-surface px-2 py-1 text-right font-semibold text-text-primary outline-none focus:border-brand-400"
          />
        </div>
      ) : (
        <span className="text-xs text-text-secondary" title="Este producto se precia por tamaño, no aquí">
          {product.sizes.map((s) => `${s.name} ${formatCOP(s.price)}`).join(' · ')}
        </span>
      )}

      <button
        type="button"
        role="switch"
        aria-checked={product.isAvailable}
        onClick={onToggleAvailable}
        title={product.isAvailable ? 'Disponible' : 'No disponible'}
        className={classNames(
          'relative h-6 w-10 shrink-0 rounded-full transition-colors duration-fast',
          product.isAvailable ? 'bg-success' : 'bg-border'
        )}
      >
        <span
          className={classNames(
            // left-0 pins the knob's static position to the track's left edge - without it, the
            // button's default `text-align: center` skews the absolutely-positioned span's base
            // position before `translate-x` is even applied, causing it to overflow the track.
            'absolute top-0.5 left-0 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-fast',
            product.isAvailable ? 'translate-x-[1.125rem]' : 'translate-x-0.5'
          )}
        />
      </button>

      <button
        type="button"
        onClick={onDelete}
        title="Eliminar producto"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors duration-fast hover:border-danger hover:text-danger"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

interface ProductListItemProps {
  product: AdminProduct;
  onOpenEdit: () => void;
}

/** Mobile/tablet (below `lg`) read-only row - price/toggle/delete don't fit next to the name without it collapsing, so editing moves into EditProductModal instead of living inline (see ProductSettingsRow for the desktop version). */
function ProductListItem({ product, onOpenEdit }: ProductListItemProps) {
  const priceLabel = product.price != null ? formatCOP(product.price) : product.sizes.map((s) => `${s.name} ${formatCOP(s.price)}`).join(' · ');

  return (
    <button
      type="button"
      onClick={onOpenEdit}
      className={classNames('flex items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left', !product.isAvailable && 'opacity-60')}
    >
      <span className={classNames('h-2 w-2 shrink-0 rounded-full', product.isAvailable ? 'bg-success' : 'bg-text-secondary')} />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{product.name}</span>
      <span className="shrink-0 whitespace-nowrap text-xs text-text-secondary">{priceLabel}</span>
      <ChevronRight size={16} className="shrink-0 text-text-secondary" />
    </button>
  );
}
